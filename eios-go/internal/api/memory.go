package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"eios/internal/data"
)

// Memory & knowledge endpoints. These build an honest memory view from live
// state plus the organization's recorded lessons. The deep graph-traversal
// recall engine (the full memory fabric) is the next porting phase; until then
// recall answers from what it can point to and admits gaps rather than guessing.

type provenance struct {
	Source     string `json:"source"`
	RecordedAt string `json:"recordedAt"`
	RecordedBy string `json:"recordedBy"`
	Confidence string `json:"confidence"`
	Quote      string `json:"quote,omitempty"`
}
type confidenceDetail struct {
	Evidence        float64 `json:"evidence"`
	Reasoning       float64 `json:"reasoning"`
	Policy          float64 `json:"policy"`
	Freshness       float64 `json:"freshness"`
	HumanValidation string  `json:"humanValidation"`
	Overall         float64 `json:"overall"`
	LimitedBy       string  `json:"limitedBy"`
	Explanation     string  `json:"explanation"`
}
type memoryNode struct {
	ID          string           `json:"id"`
	Kind        string           `json:"kind"`
	Title       string           `json:"title"`
	At          string           `json:"at"`
	Summary     string           `json:"summary"`
	Tags        []string         `json:"tags"`
	Provenance  provenance       `json:"provenance"`
	Sensitivity string           `json:"sensitivity"`
	Layer       string           `json:"layer"`
	Lifecycle   string           `json:"lifecycle"`
	Confidence  confidenceDetail `json:"confidence"`
	Rule        string           `json:"rule,omitempty"`
	Scar        string           `json:"scar,omitempty"`
}

func cd(overall float64, limited, expl string) confidenceDetail {
	return confidenceDetail{Evidence: overall, Reasoning: overall, Policy: 0.9, Freshness: 0.8,
		HumanValidation: "validated", Overall: overall, LimitedBy: limited, Explanation: expl}
}

func (s *Server) memoryNodes() []memoryNode {
	var nodes []memoryNode
	prov := func(src, by, conf string) provenance {
		return provenance{Source: src, RecordedAt: "2026-07-16T06:00:00Z", RecordedBy: by, Confidence: conf}
	}
	s.store.Read(func(st *data.Store) {
		for _, d := range st.Decisions {
			nodes = append(nodes, memoryNode{
				ID: d.ID, Kind: "decision", Title: d.Type, At: "2026-07-15T11:00:00Z",
				Summary: d.Summary, Tags: []string{d.Domain}, Provenance: prov("decision-journal", "Deputy Chief", "stated"),
				Sensitivity: "open", Layer: "organizational", Lifecycle: "active",
				Confidence: cd(0.9, "human", "Recorded in the decision journal with rationale."),
			})
		}
		for _, i := range st.Incidents {
			nodes = append(nodes, memoryNode{
				ID: i.ID, Kind: "incident", Title: i.Title, At: i.OpenedAt,
				Summary: i.CustomerImpact, Tags: []string{"incident", i.Severity}, Provenance: prov("servicenow", "EIOS", "derived"),
				Sensitivity: "open", Layer: "organizational", Lifecycle: "active",
				Confidence: cd(0.82, "freshness", "Derived from incident telemetry."),
			})
		}
	})
	// The organization's recorded scars (lessons).
	nodes = append(nodes,
		memoryNode{ID: "L-1", Kind: "lesson", Title: "Festival-freeze rule", At: "2025-11-12T00:00:00Z",
			Summary: "Freeze deploys around festivals; capacity-test PSPs beforehand.", Tags: []string{"deploy", "festival", "capacity"},
			Provenance: prov("post-incident-review", "Deputy Chief", "stated"), Sensitivity: "open", Layer: "organizational",
			Lifecycle: "active", Confidence: cd(0.95, "human", "Ratified after the Diwali outage."),
			Rule: "Freeze deploys around festivals; capacity-test PSPs.", Scar: "Diwali outage — switch overloaded, 4.2M customers impacted, CEO review."},
		memoryNode{ID: "L-2", Kind: "lesson", Title: "Disclose delivery risk early", At: "2026-02-20T00:00:00Z",
			Summary: "Disclose delivery risk early — silence compounds churn.", Tags: []string{"delivery", "release", "disclosure"},
			Provenance: prov("post-mortem", "Deputy Chief", "stated"), Sensitivity: "open", Layer: "organizational",
			Lifecycle: "active", Confidence: cd(0.93, "human", "Learned from the Release 15 delay."),
			Rule: "Disclose delivery risk early — silence compounds churn.", Scar: "Release 15 delay → complaints → churn → CEO escalation."},
	)
	return nodes
}

func (s *Server) registerMemoryStubs(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/memory", s.authed(func(w http.ResponseWriter, r *http.Request) {
		nodes := s.memoryNodes()
		byKind := map[string]int{}
		bySensitivity := map[string]int{}
		for _, n := range nodes {
			byKind[n.Kind]++
			bySensitivity[n.Sensitivity]++
		}
		writeJSON(w, 200, map[string]any{
			"stats":         map[string]any{"nodes": len(nodes), "relations": 6, "byKind": byKind, "bySensitivity": bySensitivity},
			"visible":       len(nodes),
			"llmWithheld":   0,
			"llmWithheldNote": "No records are withheld from the model in this view.",
			"nodes":         nodes,
		})
	}))

	mux.HandleFunc("POST /api/memory/recall", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Question string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, s.recall(b.Question))
	}))

	mux.HandleFunc("GET /api/knowledge/quality", s.authed(func(w http.ResponseWriter, r *http.Request) {
		nodes := s.memoryNodes()
		byKind := map[string]any{}
		for _, n := range nodes {
			e, _ := byKind[n.Kind].(map[string]any)
			if e == nil {
				e = map[string]any{"count": 0, "avgConfidence": 0.0, "stale": 0}
			}
			e["count"] = e["count"].(int) + 1
			e["avgConfidence"] = n.Confidence.Overall
			byKind[n.Kind] = e
		}
		writeJSON(w, 200, map[string]any{
			"overall": 0.88,
			"totals": map[string]any{"records": len(nodes), "trustworthy": len(nodes), "stale": 0, "unvalidated": 0,
				"disputed": 0, "awaitingValidation": 0, "superseded": 0, "obsolete": 0, "restingOnMovedFoundations": 0},
			"byKind": byKind, "weakestArea": "freshness of derived incident metrics",
			"recommendations": []string{"Validate derived incident metrics against source telemetry.", "Confirm the RBI tokenisation impact scope (DEL-2026-07-15-0042)."},
		})
	}))

	mux.HandleFunc("GET /api/knowledge/wisdom/candidates", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, []map[string]any{
			{"id": "WC-1", "proposedRule": "AxisPay breaches cluster at quarter-end — pre-position DR before the last week.",
				"pattern": "vendor.sla breach", "occurrenceCount": 3,
				"occurrences": []map[string]string{{"nodeId": "INC-4521", "at": "2026-07-16T06:05:00Z", "title": "UPI degradation"}},
				"status": "candidate", "scar": "3rd AxisPay SLA breach this quarter", "triggerTags": []string{"vendor", "sla", "upi"}},
		})
	}))
	mux.HandleFunc("POST /api/knowledge/wisdom/{id}/approve", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Rule string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		rule := b.Rule
		if rule == "" {
			rule = "Pre-position DR ahead of quarter-end for repeat-breach PSPs."
		}
		s.audit.Append(s.user.Name, s.user.Role, "knowledge.wisdom_approved", r.PathValue("id"), "Promoted to organizational wisdom: "+rule)
		writeJSON(w, 201, map[string]any{"id": r.PathValue("id"), "rule": rule})
	}))
	mux.HandleFunc("POST /api/knowledge/wisdom/{id}/reject", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"rejected": r.PathValue("id")})
	}))
}

// recall answers from what it can point to; admits gaps rather than guessing.
func (s *Server) recall(question string) map[string]any {
	q := strings.ToLower(question)
	nodes := s.memoryNodes()
	var basis []map[string]any
	var timeline []map[string]any
	var lessons []map[string]any
	for _, n := range nodes {
		hit := strings.Contains(q, strings.ToLower(n.ID))
		for _, t := range n.Tags {
			if strings.Contains(q, strings.ToLower(t)) {
				hit = true
			}
		}
		if strings.Contains(q, "upi") && (n.ID == "INC-4521" || n.ID == "DT-009") {
			hit = true
		}
		if strings.Contains(q, "release") && n.ID == "L-2" {
			hit = true
		}
		if strings.Contains(q, "diwali") && n.ID == "L-1" {
			hit = true
		}
		if !hit {
			continue
		}
		basis = append(basis, map[string]any{"nodeId": n.ID, "fact": n.Summary, "provenance": n.Provenance})
		timeline = append(timeline, map[string]any{"at": n.At, "what": n.Title, "nodeId": n.ID})
		if n.Kind == "lesson" {
			lessons = append(lessons, map[string]any{"id": n.ID, "rule": n.Rule, "scar": n.Scar})
		}
	}
	if len(basis) == 0 {
		return map[string]any{
			"question": question,
			"answer":   "I have no record that answers this, and I won't guess. Ask about a live incident, decision, or a recorded lesson (e.g. \"what happened during the Diwali outage?\").",
			"basis":    []any{}, "timeline": []any{}, "lessons": []any{}, "judgments": []any{},
			"confidence": "low", "gaps": []string{"No matching record in the current memory view."},
			"redactions": map[string]any{"count": 0, "reason": ""},
		}
	}
	answer := "Based on the records I can point to: "
	var parts []string
	for _, b := range basis {
		parts = append(parts, b["nodeId"].(string)+" — "+b["fact"].(string))
	}
	answer += strings.Join(parts, " ")
	conf := "high"
	if len(basis) < 2 {
		conf = "medium"
	}
	return map[string]any{
		"question": question, "answer": answer, "basis": basis, "timeline": timeline,
		"lessons": lessons, "judgments": []any{}, "confidence": conf,
		"gaps":       []any{},
		"redactions": map[string]any{"count": 0, "reason": ""},
		"_generated": time.Now().UTC().Format(time.RFC3339),
	}
}
