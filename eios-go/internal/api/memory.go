package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"

	"eios/internal/memory"
)

// Memory & knowledge endpoints, backed by the real fabric.
//
// SINGLE USER: he sees all of his own memory (HumanAccess). The boundary that
// still exists is EGRESS — what may be placed in a prompt bound for a model
// (LLMAccess). That gate lives in the fabric, not in these handlers.

func (s *Server) registerMemory(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/memory", s.authed(func(w http.ResponseWriter, r *http.Request) {
		all := s.memory.All(memory.HumanAccess)
		withheld := s.memory.LLMWithheld()
		sort.SliceStable(all, func(i, j int) bool { return all[i].At > all[j].At })
		note := "No records are withheld from the model."
		if len(withheld) > 0 {
			note = fmt.Sprintf("%d record(s) are personal or restricted — you can read them; they are never sent to a model.", len(withheld))
		}
		writeJSON(w, 200, map[string]any{
			"stats":           s.memory.Stats(),
			"visible":         len(all),
			"llmWithheld":     len(withheld),
			"llmWithheldNote": note,
			"nodes":           all,
		})
	}))

	// Executive recall — structured, provenance-traced, free, no model call.
	mux.HandleFunc("POST /api/memory/recall", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Question string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, s.memory.Recall(b.Question, memory.HumanAccess))
	}))

	mux.HandleFunc("GET /api/memory/lessons", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.memory.ByKind("lesson", memory.HumanAccess))
	}))

	mux.HandleFunc("GET /api/memory/entity/{id}", s.authed(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		node, ok := s.memory.Get(id, memory.HumanAccess)
		if !ok {
			errJSON(w, 404, "No memory record '"+id+"'")
			return
		}
		writeJSON(w, 200, map[string]any{
			"node":    node,
			"related": s.memory.Neighbors(id, "", memory.HumanAccess),
			"trace":   s.memory.Trace(id, memory.HumanAccess, 2),
			// Honest: would this record be placed in a prompt, or held here?
			"sentToLlm": node.Sensitivity == memory.Open,
		})
	}))

	mux.HandleFunc("GET /api/memory/timeline/{entityRef}", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.memory.Timeline(r.PathValue("entityRef"), memory.HumanAccess))
	}))

	// The system's assessment of its OWN reliability.
	mux.HandleFunc("GET /api/knowledge/quality", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, knowledgeQuality(s.memory))
	}))

	mux.HandleFunc("GET /api/knowledge/wisdom/candidates", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.wisdom.list())
	}))
	mux.HandleFunc("POST /api/knowledge/wisdom/{id}/approve", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Rule string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		res, ok := s.wisdom.approve(s.memory, r.PathValue("id"), b.Rule)
		if !ok {
			errJSON(w, 404, "No such candidate")
			return
		}
		s.audit.Append(s.user.Name, s.user.Role, "knowledge.wisdom_approved", res.ID,
			"Promoted to organizational wisdom: "+res.Rule)
		writeJSON(w, 201, res)
	}))
	mux.HandleFunc("POST /api/knowledge/wisdom/{id}/reject", s.authed(func(w http.ResponseWriter, r *http.Request) {
		if !s.wisdom.reject(r.PathValue("id")) {
			errJSON(w, 404, "No such candidate")
			return
		}
		writeJSON(w, 200, map[string]any{"rejected": r.PathValue("id")})
	}))
}

// knowledgeQuality grades the fabric on its own terms: what is trustworthy,
// what is merely derived, what rests on ground that has moved.
func knowledgeQuality(f *memory.Fabric) map[string]any {
	all := f.All(memory.HumanAccess)
	byKind := map[string]map[string]any{}
	var sum float64
	trustworthy, derived, atRisk := 0, 0, 0

	for _, n := range all {
		sum += n.Confidence.Overall
		e := byKind[n.Kind]
		if e == nil {
			e = map[string]any{"count": 0, "avgConfidence": 0.0, "stale": 0}
		}
		e["count"] = e["count"].(int) + 1
		e["avgConfidence"] = e["avgConfidence"].(float64) + n.Confidence.Overall
		byKind[n.Kind] = e

		if n.Provenance.Confidence == memory.Stated && n.Confidence.Overall >= 0.85 {
			trustworthy++
		}
		if n.Provenance.Confidence == memory.Derived {
			derived++
		}
		if n.Kind == "decision" && n.RevisitCondition != "" && n.RevisitMet {
			atRisk++
		}
	}
	for k, e := range byKind {
		e["avgConfidence"] = round2(e["avgConfidence"].(float64) / float64(e["count"].(int)))
		byKind[k] = e
	}
	overall := 0.0
	if len(all) > 0 {
		overall = round2(sum / float64(len(all)))
	}
	recs := []string{}
	if derived > 0 {
		recs = append(recs, fmt.Sprintf("%d record(s) are derived from telemetry rather than stated by a person — validate them before relying on them.", derived))
	}
	if atRisk > 0 {
		recs = append(recs, fmt.Sprintf("%d decision(s) have met their revisit condition and are due for review.", atRisk))
	}
	if len(recs) == 0 {
		recs = append(recs, "No action needed: every record is stated and current.")
	}
	weakest := "none"
	if derived > 0 {
		weakest = "freshness of derived metrics"
	}
	return map[string]any{
		"overall": overall,
		"totals": map[string]any{
			"records": len(all), "trustworthy": trustworthy, "stale": 0,
			"unvalidated": derived, "disputed": 0, "awaitingValidation": 0,
			"superseded": 0, "obsolete": 0, "restingOnMovedFoundations": atRisk,
		},
		"byKind": byKind, "weakestArea": weakest, "recommendations": recs,
	}
}

func round2(f float64) float64 { return float64(int64(f*100+0.5)) / 100 }
