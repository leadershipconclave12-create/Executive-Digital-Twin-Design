package api

import (
	"net/http"
	"strconv"

	"eios/internal/agent"
	"eios/internal/data"
	"eios/internal/domain"
	"eios/internal/ingest"
)

// Local-agent endpoints. This is what turns the graph from a simulation into
// his actual desktop: what he's looking at, what's really in his inbox, what
// he's been working on.

func (s *Server) registerAgent(mux *http.ServeMux) {
	// What app is in front of him right now + time-on-app today.
	mux.HandleFunc("GET /api/activity", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.agent.Snapshot())
	}))

	// His real mailbox, read locally via Outlook COM. Read-only.
	mux.HandleFunc("GET /api/local/mailbox", s.authed(func(w http.ResponseWriter, r *http.Request) {
		limit := 25
		if q := r.URL.Query().Get("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		writeJSON(w, 200, agent.ReadMailbox(limit))
	}))

	// What he's been working on.
	mux.HandleFunc("GET /api/local/docs", s.authed(func(w http.ResponseWriter, r *http.Request) {
		limit := 20
		if q := r.URL.Query().Get("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		docs := agent.RecentDocs(limit)
		writeJSON(w, 200, map[string]any{"count": len(docs), "docs": docs})
	}))

	// THE UNLOCK: read his real inbox and triage it into the priority queue.
	// Needs a model (AiNxt / Anthropic). PII is redacted before egress.
	mux.HandleFunc("POST /api/local/triage", s.authed(func(w http.ResponseWriter, r *http.Request) {
		limit := 25
		if q := r.URL.Query().Get("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		mb := agent.ReadMailbox(limit)
		if !mb.Available {
			errJSON(w, 503, "Cannot reach Outlook on this machine: "+mb.Error)
			return
		}
		if !s.llm.Configured() {
			errJSON(w, 503, "No model configured — set EIOS_LLM_BASE_URL (AiNxt) to triage real mail.")
			return
		}
		emails := make([]ingest.Email, 0, len(mb.Messages))
		for _, m := range mb.Messages {
			from := m.From
			if m.Address != "" {
				from = m.From + " <" + m.Address + ">"
			}
			emails = append(emails, ingest.Email{
				ID: m.ID, From: from, To: m.To, Date: m.Date, Subject: m.Subject, Body: m.Body,
			})
		}
		results, errs, cost := ingest.TriageBatch(s.llm, emails)
		s.store.Write(func(st *data.Store) {
			var sigs []domain.Signal
			for _, res := range results {
				sigs = append(sigs, ingest.ToSignal(res))
			}
			st.Signals = sigs
		})
		s.pulse.Beat(true)
		s.audit.Append(s.user.Name, s.user.Role, "mail.triaged", "inbox",
			"triaged "+strconv.Itoa(len(results))+" real messages from Outlook")
		writeJSON(w, 200, map[string]any{
			"source": "outlook-local", "inboxTotal": mb.Total, "unread": mb.Unread,
			"triaged": len(results), "errors": errs, "totalCostUsd": cost,
			"stats": ingest.Stats(results), "results": ingest.ResultsDTO(results),
			"meetings": mb.Meetings,
		})
	}))
}
