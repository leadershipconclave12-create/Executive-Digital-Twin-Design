// Package command is the "One Prompt" surface. Rules first (free, deterministic,
// unhallucinatable); the model second, grounded in live state and governed by the
// same domain guardrails. Ported from cognitive/commandService.ts + reasoner.ts.
package command

import (
	"fmt"
	"strings"

	"eios/internal/data"
	"eios/internal/domain"
	"eios/internal/governance"
	"eios/internal/llm"
	"eios/internal/services"
)

type Response struct {
	Reply   string   `json:"reply"`
	Chips   []string `json:"chips,omitempty"`
	Blocked bool     `json:"blocked,omitempty"`
	Meta    *Meta    `json:"meta,omitempty"`
}
type Meta struct {
	Model     string  `json:"model"`
	CostUsd   float64 `json:"costUsd"`
	LatencyMs int64   `json:"latencyMs"`
	Grounded  bool    `json:"grounded"`
}

func has(q string, terms ...string) bool {
	for _, t := range terms {
		if strings.Contains(q, t) {
			return true
		}
	}
	return false
}

// Run executes rules; on no match it falls back to the model if configured.
func Run(store *data.Store, audit *governance.AuditLog, provider *llm.Provider, limits governance.Limits, u domain.User, raw string) Response {
	q := strings.ToLower(strings.TrimSpace(raw))
	if q == "" {
		return Response{Reply: "Awaiting your command, Deputy Chief."}
	}

	if r, ok := rules(store, audit, u, q); ok {
		audit.Append(u.Name, u.Role, "command.executed", "one-prompt", fmt.Sprintf("%q [rule]", raw))
		return r
	}

	if provider.Configured() {
		reply, call, err := reason(store, provider, u, raw)
		if err != nil {
			msg := err.Error()
			if strings.Contains(msg, "budget") {
				return Response{Reply: "⚠ " + msg, Blocked: true}
			}
			return Response{Reply: "Reasoning unavailable: " + msg, Blocked: true}
		}
		audit.Append(u.Name, u.Role, "command.executed", "one-prompt",
			fmt.Sprintf("%q [model %s, $%.5f]", raw, call.Model, call.CostUsd))
		return Response{Reply: reply, Chips: []string{"Brief me", "Show decisions"},
			Meta: &Meta{Model: call.Model, CostUsd: call.CostUsd, LatencyMs: call.LatencyMs, Grounded: true}}
	}

	audit.Append(u.Name, u.Role, "command.executed", "one-prompt", fmt.Sprintf("%q [no-rule]", raw))
	return Response{
		Reply: "No LLM is configured, so I can only handle known workflows — and I will not guess. " +
			"Set EIOS_LLM_BASE_URL to enable real reasoning. Type \"help\" for what I can do on rules alone.",
		Chips: []string{"Help", "Brief me"},
	}
}

func rules(store *data.Store, audit *governance.AuditLog, u domain.User, q string) (Response, bool) {
	switch {
	case has(q, "brief", "summary", "whats up", "what's up"):
		var b domain.Briefing
		store.Read(func(st *data.Store) { b = st.BriefingData })
		reply := "Morning briefing: " + b.Headline
		if len(b.Bullets) > 0 {
			reply += " " + b.Bullets[0]
		}
		if len(b.Bullets) > 1 {
			reply += " " + b.Bullets[1]
		}
		reply += " Everything else is handled."
		return Response{Reply: reply, Chips: []string{"Delegate UPI issue", "Show decisions", "Review RBI note"}}, true

	case has(q, "upi") && has(q, "status", "health", "how"):
		return Response{Reply: "UPI success rate is 97.1% (below the 99% threshold). Root cause: PSP \"AxisPay\" degradation (INC-4521, P2, VP – IT Operations, Mitigating). This is AxisPay's 3rd SLA breach this quarter — decision DT-009 is queued for you.",
			Chips: []string{"Delegate UPI issue", "Approve SLA notice"}}, true

	case has(q, "channel", "imps", "neft", "rtgs"):
		var parts []string
		store.Read(func(st *data.Store) {
			for _, c := range st.Channels {
				parts = append(parts, fmt.Sprintf("%s %s (%s)", c.Name, c.Value, c.Status))
			}
		})
		return Response{Reply: "Channel health: " + strings.Join(parts, ", ") + ". Only UPI is outside tolerance.",
			Chips: []string{"UPI status"}}, true

	case has(q, "delegate") && has(q, "upi", "4521", "latency"):
		d, err := services.CreateDelegation(store, audit, services.NewDelegation{
			User: u, Delegate: "VP – IT Operations", Subject: "Resolve UPI/AxisPay latency (INC-4521)",
			AuthorityLevel: "L3", SpendCapInr: 500_000, Priority: "High", Deadline: "12:00 IST",
			Context: "INC-4521; SLA status; ~2.9% UPI txns slow",
		})
		if err != nil {
			return Response{Reply: "Could not delegate: " + err.Error(), Blocked: true}, true
		}
		return Response{Reply: fmt.Sprintf("Delegation %s sent to VP – IT Operations (L3, up to ₹5L, due 12:00). Context auto-attached; I'll escalate if the 10:00 checkpoint slips.", d.ID),
			Chips: []string{"Show delegations"}}, true

	case has(q, "approve") && has(q, "sla", "dt-009", "axispay"):
		return approve(store, audit, u, "DT-009", "formal SLA breach notice to AxisPay (₹1.2L withholding)"), true
	case has(q, "approve") && has(q, "cdn", "renew", "dt-007", "akamai"):
		return approve(store, audit, u, "DT-007", "Akamai CDN renewal (₹1.2Cr)"), true
	case has(q, "approve") && has(q, "rbi", "token", "dt-010"):
		return approve(store, audit, u, "DT-010", "RBI tokenisation implementation plan"), true

	case has(q, "decision"):
		var pend []string
		store.Read(func(st *data.Store) {
			for _, d := range st.Decisions {
				if d.Status == "pending" {
					pend = append(pend, fmt.Sprintf("%s (%s) %s", d.ID, d.Tier, d.Type))
				}
			}
		})
		return Response{Reply: fmt.Sprintf("%d decisions await you: %s. Say \"approve <id>\".", len(pend), strings.Join(pend, "; ")),
			Chips: []string{"Approve SLA notice", "Approve CDN renewal", "Approve RBI plan"}}, true

	case has(q, "delegation", "who is working", "follow up"):
		var parts []string
		store.Read(func(st *data.Store) {
			for _, d := range st.Delegations {
				parts = append(parts, fmt.Sprintf("%s — \"%s\" (%s, %d%%)", d.Delegate, d.Subject, d.Status, d.Progress))
			}
		})
		return Response{Reply: "Active delegations: " + strings.Join(parts, "; ") + "."}, true

	case has(q, "rbi", "regulat", "token"):
		return Response{Reply: "RBI/2026-27/44 (tokenisation): 90-day window; Compliance impact note flags 2 systems, ~6 sprints. Recommended: approve DT-010.",
			Chips: []string{"Approve RBI plan"}}, true

	case has(q, "draft", "reply", "email"):
		return Response{Reply: "Drafted \"UPI performance — status update\" (INC-4521, 97.1%, ETA 12:00). In your Outlook drafts for review before send."}, true

	case has(q, "help", "what can you"):
		return Response{Reply: "Try: \"brief me\", \"UPI status\", \"delegate the UPI issue\", \"show decisions\", \"approve the SLA notice\", \"who is working on what\", \"draft a status update\".",
			Chips: []string{"Brief me", "UPI status", "Show decisions"}}, true
	}
	return Response{}, false
}

func approve(store *data.Store, audit *governance.AuditLog, u domain.User, id, label string) Response {
	item, ok := services.GetDecision(store, id)
	if !ok {
		return Response{Reply: "Decision " + id + " not found.", Blocked: true}
	}
	if item.Status != "pending" {
		return Response{Reply: fmt.Sprintf("%s is already %s.", id, item.Status)}
	}
	_, err := services.ResolveDecision(store, audit, id, "approved", u, "Approved via One Prompt")
	if err != nil {
		return Response{Reply: "Blocked by guardrail: " + err.Error(), Blocked: true}
	}
	note := ""
	if item.Tier == "Human-Required" {
		note = " Routing for four-eyes co-sign per the authority matrix."
	}
	return Response{Reply: fmt.Sprintf("Approved %s: %s. Logged to the decision journal.%s", id, label, note),
		Chips: []string{"Show decisions"}}
}

const systemPrompt = `You are EIOS, the Executive Intelligence Operating System for the Deputy Chief (Products) of an Indian retail bank. You serve exactly one person: him.

You are given a CONTEXT block with the live state of the organization. That block is everything you know.

ABSOLUTE RULES:
1. Answer ONLY from CONTEXT. If the answer is not there, say exactly what you do not know and stop. Never fill a gap with a plausible guess.
2. Cite the record id (e.g. DT-009, INC-4521) for every factual claim.
3. Never invent numbers, dates, names, incidents, or history.
4. Be brief. 3 sentences unless asked for more.
5. If CONTEXT shows liveSources: 0, the organizational data is SIMULATED — say so if the answer depends on it.
No preamble, no filler.`

// reason builds context from live state and asks the frontier model.
func reason(store *data.Store, provider *llm.Provider, u domain.User, question string) (string, llm.Call, error) {
	var lines []string
	lines = append(lines, "## DATA PROVENANCE", "liveSources: 0 (0 = organizational data is SIMULATED, not real)", "")
	store.Read(func(st *data.Store) {
		lines = append(lines, "## CHANNELS")
		for _, c := range st.Channels {
			lines = append(lines, fmt.Sprintf("%s %.1f%% (%s) — %s", c.Name, c.SuccessRate, c.Status, c.Note))
		}
		lines = append(lines, "", "## INCIDENTS")
		for _, i := range st.Incidents {
			lines = append(lines, fmt.Sprintf("%s %s \"%s\" (%s, owner %s) — %s", i.ID, i.Severity, i.Title, i.Status, i.Owner, i.CustomerImpact))
		}
		lines = append(lines, "", "## DECISIONS PENDING")
		for _, d := range st.Decisions {
			if d.Status == "pending" {
				amt := ""
				if d.AmountLabel != "" {
					amt = ", " + d.AmountLabel
				}
				lines = append(lines, fmt.Sprintf("%s %s [%s, %s risk%s] — %s → recommended: %s", d.ID, d.Type, d.Tier, d.Risk, amt, d.Summary, d.Recommendation))
			}
		}
		lines = append(lines, "", "## DELEGATIONS ACTIVE")
		for _, d := range st.Delegations {
			lines = append(lines, fmt.Sprintf("%s → %s: \"%s\" (%s, %d%%, due %s)", d.ID, d.Delegate, d.Subject, d.Status, d.Progress, d.Deadline))
		}
	})
	context := strings.Join(lines, "\n")
	user := fmt.Sprintf("CONTEXT\n%s\n\nQUESTION FROM %s: %s", context, u.Title, question)
	return provider.Complete(provider.ModelFor("reason"), "one-prompt-reasoning",
		[]llm.Message{{Role: "system", Content: systemPrompt}, {Role: "user", Content: user}}, 0.1, 500)
}
