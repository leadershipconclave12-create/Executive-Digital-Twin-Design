// Package ingest is the real email-triage workflow: parse an export, redact PII
// before anything leaves the machine, and triage each mail with a real (cheap)
// model call. Ported from ingest/email.ts + triage.ts + llm/redact.ts.
package ingest

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"eios/internal/domain"
	"eios/internal/llm"
)

type Email struct {
	ID      string `json:"id"`
	From    string `json:"from"`
	To      string `json:"to"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// ParseEmails accepts a JSON array or CSV export.
func ParseEmails(raw, filename string) ([]Email, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty input")
	}
	if strings.HasPrefix(raw, "[") || strings.HasSuffix(strings.ToLower(filename), ".json") {
		var arr []Email
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			return nil, fmt.Errorf("could not parse JSON email array: %v", err)
		}
		for i := range arr {
			if arr[i].ID == "" {
				arr[i].ID = fmt.Sprintf("mail-%d", i+1)
			}
		}
		return arr, nil
	}
	// CSV fallback (Outlook export). Expect a header row.
	r := csv.NewReader(strings.NewReader(raw))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil || len(rows) < 2 {
		return nil, fmt.Errorf("could not parse any email (try ?filename=x.json with a JSON array)")
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	get := func(row []string, keys ...string) string {
		for _, k := range keys {
			if idx, ok := col[k]; ok && idx < len(row) {
				return row[idx]
			}
		}
		return ""
	}
	var out []Email
	for i, row := range rows[1:] {
		out = append(out, Email{
			ID:      fmt.Sprintf("mail-%d", i+1),
			From:    get(row, "from", "from: (name)", "from: (address)"),
			To:      get(row, "to", "to: (name)"),
			Date:    get(row, "date", "received", "sent"),
			Subject: get(row, "subject"),
			Body:    get(row, "body", "body text"),
		})
	}
	return out, nil
}

// --- Redaction (before anything leaves the machine) -------------------------

var (
	reAccount = regexp.MustCompile(`\b\d{9,18}\b`)
	reCard    = regexp.MustCompile(`\b(?:\d[ -]?){13,16}\b`)
	reEmail   = regexp.MustCompile(`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`)
	reUPI     = regexp.MustCompile(`\b[A-Za-z0-9._-]+@(?:ok[a-z]+|[a-z]{2,}bank|upi|paytm|ybl|axl)\b`)
	rePhone   = regexp.MustCompile(`(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b`)
)

type Redaction struct {
	Text   string
	Counts map[string]int
}

func redact(s string) Redaction {
	counts := map[string]int{}
	repl := func(re *regexp.Regexp, tag string, in string) string {
		return re.ReplaceAllStringFunc(in, func(m string) string {
			counts[tag]++
			return fmt.Sprintf("[%s_%d]", tag, counts[tag])
		})
	}
	// order matters: UPI ids before generic email; cards before accounts
	s = repl(reUPI, "UPI", s)
	s = repl(reEmail, "EMAIL", s)
	s = repl(reCard, "CARD", s)
	s = repl(reAccount, "ACCOUNT", s)
	s = repl(rePhone, "PHONE", s)
	return Redaction{Text: s, Counts: counts}
}

func summarizeRedaction(counts map[string]int) string {
	if len(counts) == 0 {
		return "none"
	}
	var parts []string
	for k, v := range counts {
		parts = append(parts, fmt.Sprintf("%d %s", v, strings.ToLower(k)))
	}
	return strings.Join(parts, ", ")
}

// --- Triage -----------------------------------------------------------------

const triageSystem = `You are the triage function of an Executive Intelligence Operating System for the Deputy Chief (Products) of an Indian retail bank.

Your ONLY job: decide what this email is and who should handle it. You are the filter that protects ~8 hours of executive time per day.

Their direct reports (delegate to these, not the executive, where possible): "VP – IT Operations", "VP – Digital Banking", "VP – Application Dev", "Compliance Officer", "Chief of Staff".

PRIORITY RULES:
- "urgent" = live customer/money impact, or a regulator waiting. Minutes matter.
- "critical" = material risk or a decision only the executive can make. Today.
- "routine" = real work, but a delegate can own it.
- "informational" = FYI, newsletters, automated reports. Nobody acts.

HARD RULES:
1. Be RUTHLESS. Most mail is informational.
2. needsExecutive = true ONLY if a delegate genuinely cannot own it.
3. If unsure, LOW confidence and needsExecutive=true.
4. Values like [ACCOUNT_1] are redacted PII — reason about them, never guess contents.
5. Judge ONLY what is in the email.

Reply with ONLY this JSON:
{"priority":"urgent|critical|routine|informational","summary":"one line","suggestedAction":"what to do","office":"intelligence|operations|coordination|analytics|compliance|delivery","needsExecutive":true,"delegateTo":"role or null","confidence":0.0,"reasoning":"one line"}`

type Verdict struct {
	Priority        string  `json:"priority"`
	Summary         string  `json:"summary"`
	SuggestedAction string  `json:"suggestedAction"`
	Office          string  `json:"office"`
	NeedsExecutive  bool    `json:"needsExecutive"`
	DelegateTo      string  `json:"delegateTo"`
	Confidence      float64 `json:"confidence"`
	Reasoning       string  `json:"reasoning"`
}

type Result struct {
	Email     Email
	Verdict   Verdict
	Redaction string
	CostUsd   float64
	Model     string
}

var jsonObj = regexp.MustCompile(`\{[\s\S]*\}`)

func TriageOne(p *llm.Provider, e Email) (Result, error) {
	prompt := fmt.Sprintf("From: %s\nTo: %s\nDate: %s\nSubject: %s\n\n%s", e.From, e.To, e.Date, e.Subject, clip(e.Body, 2500))
	r := redact(prompt)
	text, call, err := p.Complete(p.ModelFor("triage"), "email-triage",
		[]llm.Message{{Role: "system", Content: triageSystem}, {Role: "user", Content: r.Text}}, 0, 250)
	if err != nil {
		return Result{}, err
	}
	var v Verdict
	if m := jsonObj.FindString(text); m != "" {
		_ = json.Unmarshal([]byte(m), &v)
	}
	if v.Priority == "" {
		// Unparseable ⇒ escalate, never silently drop.
		v = Verdict{Priority: "critical", Summary: e.Subject, SuggestedAction: "Review manually — could not parse model response.",
			Office: "intelligence", NeedsExecutive: true, Confidence: 0, Reasoning: "unparseable model output"}
	}
	if v.Confidence < 0.5 {
		v.NeedsExecutive = true
	}
	return Result{Email: e, Verdict: v, Redaction: summarizeRedaction(r.Counts), CostUsd: call.CostUsd, Model: call.Model}, nil
}

// TriageBatch triages sequentially (bounded — the model is metered).
func TriageBatch(p *llm.Provider, emails []Email) ([]Result, []map[string]string, float64) {
	var results []Result
	var errs []map[string]string
	var cost float64
	for _, e := range emails {
		res, err := TriageOne(p, e)
		if err != nil {
			if strings.Contains(err.Error(), "budget") {
				break // stop the whole run on budget exhaustion
			}
			errs = append(errs, map[string]string{"id": e.ID, "error": err.Error()})
			continue
		}
		results = append(results, res)
		cost += res.CostUsd
	}
	return results, errs, round(cost, 5)
}

var rank = map[string]int{"urgent": 0, "critical": 1, "routine": 2, "informational": 3}

func ToSignal(t Result) domain.Signal {
	office := t.Verdict.Office
	if office != "" {
		office = strings.ToUpper(office[:1]) + office[1:]
	}
	action := t.Verdict.SuggestedAction
	if t.Verdict.DelegateTo != "" && t.Verdict.DelegateTo != "null" && !t.Verdict.NeedsExecutive {
		action = fmt.Sprintf("%s → delegate to %s", action, t.Verdict.DelegateTo)
	}
	return domain.Signal{
		ID: t.Email.ID, Source: "Email", Title: t.Email.Subject, Summary: t.Verdict.Summary,
		Priority: t.Verdict.Priority, ReceivedAt: t.Email.Date, SuggestedAction: action,
		Agent: office, Handled: false,
	}
}

func Stats(results []Result) map[string]any {
	total := len(results)
	if total == 0 {
		return nil
	}
	needsExec := 0
	byPriority := map[string]int{}
	low := 0
	for _, r := range results {
		if r.Verdict.NeedsExecutive {
			needsExec++
		}
		byPriority[r.Verdict.Priority]++
		if r.Verdict.Confidence < 0.5 {
			low++
		}
	}
	return map[string]any{
		"total": total, "needsExecutive": needsExec, "filteredOut": total - needsExec,
		"reductionPct": int(float64(total-needsExec) / float64(total) * 100),
		"byPriority":   byPriority, "lowConfidence": low,
		"minutesSaved": (total - needsExec) * 2,
	}
}

func ResultsDTO(results []Result) []map[string]any {
	var out []map[string]any
	for _, r := range results {
		out = append(out, map[string]any{
			"id": r.Email.ID, "from": r.Email.From, "subject": r.Email.Subject,
			"priority": r.Verdict.Priority, "summary": r.Verdict.Summary,
			"suggestedAction": r.Verdict.SuggestedAction, "needsExecutive": r.Verdict.NeedsExecutive,
			"delegateTo": r.Verdict.DelegateTo, "confidence": r.Verdict.Confidence,
			"redaction": r.Redaction, "costUsd": r.CostUsd,
		})
	}
	return out
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
func round(f float64, places int) float64 {
	p := 1.0
	for i := 0; i < places; i++ {
		p *= 10
	}
	return float64(int64(f*p+0.5)) / p
}
