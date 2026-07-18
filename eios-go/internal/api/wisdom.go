package api

import (
	"sync"
	"time"

	"eios/internal/memory"
)

// The wisdom engine: EIOS notices a repeating pattern and PROPOSES a rule.
// It never promotes one itself — setting organizational policy is an executive
// act, not a memory write. The system proposes; a human disposes.

type occurrence struct {
	NodeID string `json:"nodeId"`
	At     string `json:"at"`
	Title  string `json:"title"`
}

type candidate struct {
	ID              string       `json:"id"`
	ProposedRule    string       `json:"proposedRule"`
	Pattern         string       `json:"pattern"`
	OccurrenceCount int          `json:"occurrenceCount"`
	Occurrences     []occurrence `json:"occurrences"`
	Status          string       `json:"status"` // candidate | approved | rejected
	Scar            string       `json:"scar"`
	TriggerTags     []string     `json:"triggerTags"`
}

type approved struct {
	ID   string `json:"id"`
	Rule string `json:"rule"`
}

type wisdomEngine struct {
	mu   sync.Mutex
	cand map[string]*candidate
	ord  []string
}

func newWisdom() *wisdomEngine {
	w := &wisdomEngine{cand: map[string]*candidate{}}
	w.add(&candidate{
		ID:           "WC-1",
		ProposedRule: "On a vendor's third SLA breach in a quarter, issue the contractual notice immediately rather than escalating verbally.",
		Pattern:      "vendor.sla breach repeated within one quarter",
		Occurrences: []occurrence{
			{NodeID: "INC-4521", At: "2026-07-16T06:05:00Z", Title: "UPI degradation (AxisPay, 3rd breach)"},
			{NodeID: "J-1", At: "2026-04-02T00:00:00Z", Title: "Prior judgment on vendor SLA breaches"},
		},
		Status:      "candidate",
		Scar:        "Verbal escalation with AxisPay produced no change and cost us the penalty window.",
		TriggerTags: []string{"vendor", "sla", "breach", "upi"},
	})
	w.add(&candidate{
		ID:           "WC-2",
		ProposedRule: "Re-estimate any partnership integration after tokenisation scope is added, before committing to a commercial deadline.",
		Pattern:      "estimate doubled once regulatory scope was included",
		Occurrences: []occurrence{
			{NodeID: "EV-188", At: "2026-03-08T14:00:00Z", Title: "Engineering estimate doubled to 8 sprints"},
			{NodeID: "D-193", At: "2026-03-14T10:30:00Z", Title: "Rejected XYZ Bank's proposal"},
		},
		Status:      "candidate",
		Scar:        "The XYZ deadline arrived before the true cost was known.",
		TriggerTags: []string{"estimate", "partnership", "tokenisation", "deadline"},
	})
	return w
}

func (w *wisdomEngine) add(c *candidate) {
	c.OccurrenceCount = len(c.Occurrences)
	w.cand[c.ID] = c
	w.ord = append(w.ord, c.ID)
}

func (w *wisdomEngine) list() []candidate {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := []candidate{}
	for _, id := range w.ord {
		if c := w.cand[id]; c.Status == "candidate" {
			out = append(out, *c)
		}
	}
	return out
}

// approve promotes a candidate into the fabric as a real, citable lesson —
// so it can change future recommendations, not just sit in a list.
func (w *wisdomEngine) approve(f *memory.Fabric, id, rule string) (approved, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	c, ok := w.cand[id]
	if !ok || c.Status != "candidate" {
		return approved{}, false
	}
	if rule == "" {
		rule = c.ProposedRule
	}
	c.Status = "approved"
	lessonID := "L-" + id

	f.Add(memory.Node{
		ID: lessonID, Kind: "lesson", Title: "Approved wisdom: " + c.Pattern,
		At: time.Now().UTC().Format(time.RFC3339), Summary: rule,
		Tags: c.TriggerTags, Rule: rule, Scar: c.Scar,
		Provenance: memory.Provenance{
			Source: "wisdom-engine (approved by the executive)", RecordedAt: time.Now().UTC().Format(time.RFC3339),
			RecordedBy: "Deputy Chief", Confidence: memory.Stated,
		},
		Sensitivity: memory.Open, Layer: "organizational", Lifecycle: "active",
		Confidence: memory.ConfidenceDetail{
			Evidence: 0.9, Reasoning: 0.9, Policy: 1, Freshness: 1,
			HumanValidation: "validated", Overall: 0.93, LimitedBy: "human",
			Explanation: "Proposed from a repeated pattern and explicitly approved by the executive.",
		},
	})
	// Tie the new rule back to the episodes that taught it.
	for _, o := range c.Occurrences {
		f.Link(lessonID, "learned_from", o.NodeID)
	}
	return approved{ID: lessonID, Rule: rule}, true
}

func (w *wisdomEngine) reject(id string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	c, ok := w.cand[id]
	if !ok {
		return false
	}
	c.Status = "rejected"
	return true
}
