// Package llm is a real OpenAI-Chat-Completions client (the wire format Anthropic,
// Azure OpenAI, OpenRouter, LM Studio and Ollama all speak) with metered spend and
// a hard budget stop. Ported from llm/provider.ts + index.ts. Stdlib only.
package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Pricing struct{ InputPer1M, OutputPer1M float64 }

// USD per 1M tokens. Unknown models fall back to frontier pricing — over-
// estimating spend is safe; under-estimating is how a budget blows silently.
var defaultPricing = map[string]Pricing{
	// Anthropic
	"claude-haiku-4-5":            {1.00, 5.00},
	"claude-haiku-4-5-20251001":   {1.00, 5.00},
	"claude-sonnet-4-6":           {3.00, 15.00},
	"claude-sonnet-5":             {3.00, 15.00},
	"claude-opus-4-8":             {5.00, 25.00},
	// OpenAI
	"gpt-4o-mini": {0.15, 0.60},
	"gpt-4o":      {2.50, 10.00},
	// AiNxt in-house models run on NPCI's own infrastructure: no per-token
	// charge, and nothing leaves the bank. This is what makes 300 triage calls
	// a day cost literally nothing.
	"qwen-3.6-35B-A3B-128K": {0, 0},
	"qwen-3.6-27B":          {0, 0},
	"gemma-4-31B-it-128K":   {0, 0},
	"deepseek-v4-flash":     {0, 0},
	"glm-5.1-fp8-128K":      {0, 0},
	"glm-5.2-fp8-128K":      {0, 0},
	"kimi-k2.7-code-128K":   {0, 0},
}

// parsePricing lets a gateway that bills differently override the table:
//
//	EIOS_LLM_PRICING={"my-model":{"inputPer1M":0.5,"outputPer1M":1.5}}
func parsePricing() map[string]Pricing {
	out := map[string]Pricing{}
	for k, v := range defaultPricing {
		out[k] = v
	}
	raw := os.Getenv("EIOS_LLM_PRICING")
	if raw == "" {
		return out
	}
	var over map[string]Pricing
	if err := json.Unmarshal([]byte(raw), &over); err == nil {
		for k, v := range over {
			out[k] = v
		}
	}
	return out
}

type Call struct {
	At               string  `json:"at"`
	Model            string  `json:"model"`
	Purpose          string  `json:"purpose"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	CostUsd          float64 `json:"costUsd"`
	LatencyMs        int64   `json:"latencyMs"`
}

type Ledger struct {
	mu     sync.Mutex
	budget float64
	calls  []Call
}

func (l *Ledger) Spent() float64 {
	var s float64
	for _, c := range l.calls {
		s += c.CostUsd
	}
	return s
}
func (l *Ledger) record(c Call) { l.mu.Lock(); l.calls = append(l.calls, c); l.mu.Unlock() }

func (l *Ledger) Report() map[string]any {
	l.mu.Lock()
	defer l.mu.Unlock()
	spent := 0.0
	byPurpose := map[string]map[string]any{}
	for _, c := range l.calls {
		spent += c.CostUsd
		e := byPurpose[c.Purpose]
		if e == nil {
			e = map[string]any{"calls": 0, "costUsd": 0.0}
		}
		e["calls"] = e["calls"].(int) + 1
		e["costUsd"] = e["costUsd"].(float64) + c.CostUsd
		byPurpose[c.Purpose] = e
	}
	remaining := l.budget - spent
	if remaining < 0 {
		remaining = 0
	}
	perCall := 0.0
	if len(l.calls) > 0 {
		perCall = spent / float64(len(l.calls))
	}
	var projected any
	if perCall > 0 {
		projected = int(remaining / perCall)
	}
	return map[string]any{
		"budgetUsd": l.budget, "spentUsd": round(spent, 5), "remainingUsd": round(remaining, 5),
		"calls": len(l.calls), "avgCostPerCallUsd": round(perCall, 6),
		"projectedCallsRemaining": projected, "byPurpose": byPurpose,
	}
}

func (l *Ledger) History(limit int) []Call {
	l.mu.Lock()
	defer l.mu.Unlock()
	if limit > len(l.calls) {
		limit = len(l.calls)
	}
	out := make([]Call, 0, limit)
	for i := len(l.calls) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, l.calls[i])
	}
	return out
}

type Provider struct {
	baseURL, apiKey        string
	small, frontier        string
	pricing                map[string]Pricing
	Ledger                 *Ledger
	client                 *http.Client
}

func New(baseURL, apiKey, small, frontier string, budget float64) *Provider {
	return &Provider{
		baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey,
		small: small, frontier: frontier, pricing: parsePricing(),
		Ledger: &Ledger{budget: budget},
		client: &http.Client{Timeout: 60 * time.Second},
	}
}

// Models asks the gateway what it actually serves (GET /models). Used to verify
// exact model ids rather than guessing them from a console screenshot.
func (p *Provider) Models() ([]string, error) {
	if !p.Configured() {
		return nil, fmt.Errorf("no LLM configured")
	}
	req, _ := http.NewRequest("GET", p.baseURL+"/models", nil)
	if p.apiKey != "" {
		req.Header.Set("authorization", "Bearer "+p.apiKey)
		req.Header.Set("x-api-key", p.apiKey)
	}
	res, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		ids = append(ids, m.ID)
	}
	return ids, nil
}

func (p *Provider) Configured() bool { return p.baseURL != "" }

// ModelFor routes a task to the cheap or frontier model — the whole cost strategy.
func (p *Provider) ModelFor(task string) string {
	switch task {
	case "triage", "classify", "summarize":
		return p.small
	default:
		return p.frontier
	}
}

func (p *Provider) SmallModel() string    { return p.small }
func (p *Provider) FrontierModel() string { return p.frontier }
func (p *Provider) BaseURL() string       { return p.baseURL }

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (p *Provider) price(model string) Pricing {
	if pr, ok := p.pricing[model]; ok {
		return pr
	}
	return Pricing{5, 15} // unknown → assume frontier; over-estimating spend is safe
}

// Complete makes one chat-completions call and meters the cost.
func (p *Provider) Complete(model, purpose string, msgs []Message, temperature float64, maxTokens int) (string, Call, error) {
	if !p.Configured() {
		return "", Call{}, fmt.Errorf("No LLM configured. Set EIOS_LLM_BASE_URL.")
	}
	if p.Ledger.Spent() >= p.Ledger.budget {
		return "", Call{}, fmt.Errorf("LLM budget exhausted: $%.4f of $%.2f used. Refusing further calls.", p.Ledger.Spent(), p.Ledger.budget)
	}
	body, _ := json.Marshal(map[string]any{
		"model": model, "messages": msgs, "temperature": temperature, "max_tokens": maxTokens,
	})
	start := time.Now()
	req, _ := http.NewRequest("POST", p.baseURL+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	if p.apiKey != "" {
		req.Header.Set("authorization", "Bearer "+p.apiKey)
		req.Header.Set("x-api-key", p.apiKey)
	}
	res, err := p.client.Do(req)
	if err != nil {
		return "", Call{}, err
	}
	defer res.Body.Close()
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
		Error json.RawMessage `json:"error"`
	}
	dec := json.NewDecoder(res.Body)
	_ = dec.Decode(&out)
	if res.StatusCode >= 400 {
		return "", Call{}, fmt.Errorf("LLM %d from %s: %s", res.StatusCode, p.baseURL, string(out.Error))
	}
	text := ""
	if len(out.Choices) > 0 {
		text = out.Choices[0].Message.Content
	}
	pt, ct := out.Usage.PromptTokens, out.Usage.CompletionTokens
	if pt == 0 {
		pt = estimateTokens(msgs)
	}
	if ct == 0 {
		ct = len(text) / 4
	}
	pr := p.price(model)
	cost := float64(pt)/1e6*pr.InputPer1M + float64(ct)/1e6*pr.OutputPer1M
	call := Call{
		At: time.Now().UTC().Format(time.RFC3339), Model: model, Purpose: purpose,
		PromptTokens: pt, CompletionTokens: ct, CostUsd: cost, LatencyMs: time.Since(start).Milliseconds(),
	}
	p.Ledger.record(call)
	return text, call, nil
}

func (p *Provider) Status() map[string]any {
	note := "NOT CONFIGURED — EIOS is running on rules only. Set EIOS_LLM_BASE_URL to enable real reasoning."
	var base any
	if p.Configured() {
		note = "Real reasoning enabled."
		base = p.baseURL
	}
	return map[string]any{
		"configured": p.Configured(), "baseUrl": base,
		"smallModel": p.small, "frontierModel": p.frontier,
		"routing": map[string]any{"cheap": []string{"triage", "classify", "summarize"}, "frontier": []string{"reason", "decide", "brief"}},
		"cost": p.Ledger.Report(), "note": note,
	}
}

func estimateTokens(msgs []Message) int {
	n := 0
	for _, m := range msgs {
		n += len(m.Content)
	}
	return n / 4
}

func round(f float64, places int) float64 {
	p := 1.0
	for i := 0; i < places; i++ {
		p *= 10
	}
	return float64(int64(f*p+0.5)) / p
}
