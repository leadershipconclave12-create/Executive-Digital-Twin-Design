// Package api exposes the EIOS HTTP surface. Same routes and JSON shapes as the
// TypeScript prototype, so the existing web UI works unchanged — plus the new
// bot pause/resume control. Stdlib net/http only (Go 1.22+ pattern routing).
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"eios/internal/agent"
	"eios/internal/command"
	"eios/internal/config"
	"eios/internal/data"
	"eios/internal/domain"
	"eios/internal/governance"
	"eios/internal/ingest"
	"eios/internal/llm"
	"eios/internal/memory"
	"eios/internal/services"
	"eios/internal/twin"
)

type Server struct {
	cfg    config.Config
	store  *data.Store
	audit  *governance.AuditLog
	pulse  *twin.Pulse
	llm    *llm.Provider
	agent  *agent.Agent
	memory *memory.Fabric
	wisdom *wisdomEngine
	limits governance.Limits
	user   domain.User
}

func NewServer(cfg config.Config, store *data.Store, audit *governance.AuditLog, pulse *twin.Pulse, provider *llm.Provider, ag *agent.Agent, mem *memory.Fabric) *Server {
	return &Server{
		cfg: cfg, store: store, audit: audit, pulse: pulse, llm: provider, agent: ag,
		memory: mem, wisdom: newWisdom(),
		limits: governance.Limits{AutonomousFinancialLimitInr: cfg.AutonomousFinancialLimitInr, AutonomousConfidence: cfg.AutonomousConfidence},
		user:   data.DeputyChief(),
	}
}

// --- helpers ----------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func errJSON(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func statusFor(err error) int {
	switch {
	case err == nil:
		return 200
	case strings.Contains(err.Error(), "not found"):
		return 404
	case strings.Contains(err.Error(), "authority") || strings.Contains(err.Error(), "already"):
		return 409
	default:
		return 400
	}
}

// auth enforces the access token for non-localhost (fail closed), matching middleware.ts.
func (s *Server) authed(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndex(host, ":"); i >= 0 {
			host = host[:i]
		}
		local := host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
		if s.cfg.AccessToken == "" {
			if !local {
				errJSON(w, 403, "Remote access refused: set EIOS_ACCESS_TOKEN to expose EIOS safely (see DEPLOY.md).")
				return
			}
		} else {
			tok := r.Header.Get("x-eios-token")
			if tok == "" {
				tok = r.URL.Query().Get("token")
			}
			if tok != s.cfg.AccessToken {
				errJSON(w, 401, "Missing or invalid access token.")
				return
			}
		}
		next(w, r)
	}
}

// Handler builds the full mux.
func (s *Server) Handler(static http.Handler) http.Handler {
	mux := http.NewServeMux()

	// health & identity (unauthenticated)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status": "ok", "aiProvider": "openai-compatible",
			"autonomousLimitInr": s.cfg.AutonomousFinancialLimitInr, "auditEntries": s.audit.Size(),
		})
	})
	mux.HandleFunc("GET /api/auth/users", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, []domain.User{data.DeputyChief()})
	})

	mux.HandleFunc("GET /api/me", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"user": s.user, "permissions": []string{}})
	}))

	// overview
	mux.HandleFunc("GET /api/overview", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var ov domain.Overview
		s.store.Read(func(st *data.Store) {
			ov = domain.Overview{
				Executive: domain.Executive{Name: st.Executive.Name, Org: "Retail Bank — Products", Date: time.Now().Format("Mon, 02 Jan 2006")},
				Briefing:  st.BriefingData, Kpis: st.Kpis, Channels: st.Channels, Incidents: st.Incidents,
			}
		})
		writeJSON(w, 200, ov)
	}))

	// signals
	mux.HandleFunc("GET /api/signals", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, services.ListSignals(s.store))
	}))
	mux.HandleFunc("POST /api/signals/{id}/handle", s.authed(func(w http.ResponseWriter, r *http.Request) {
		sig, err := services.HandleSignal(s.store, s.audit, r.PathValue("id"), s.user)
		if err != nil {
			errJSON(w, statusFor(err), err.Error())
			return
		}
		writeJSON(w, 200, sig)
	}))

	// decisions
	mux.HandleFunc("GET /api/decisions", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, services.ListDecisions(s.store))
	}))
	mux.HandleFunc("POST /api/decisions/{id}/resolve", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Decision, Rationale string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		item, err := services.ResolveDecision(s.store, s.audit, r.PathValue("id"), body.Decision, s.user, body.Rationale)
		if err != nil {
			errJSON(w, statusFor(err), err.Error())
			return
		}
		writeJSON(w, 200, item)
	}))
	mux.HandleFunc("POST /api/decisions/{id}/auto-execute", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, services.AttemptAutoExecute(s.store, s.audit, r.PathValue("id"), s.limits))
	}))

	// delegations
	mux.HandleFunc("GET /api/delegations", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, services.ListDelegations(s.store))
	}))
	mux.HandleFunc("POST /api/delegations", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Delegate, Subject, AuthorityLevel, Priority, Deadline, Context string
			SpendCapInr                                                    int64
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		d, err := services.CreateDelegation(s.store, s.audit, services.NewDelegation{
			User: s.user, Delegate: b.Delegate, Subject: b.Subject, AuthorityLevel: b.AuthorityLevel,
			SpendCapInr: b.SpendCapInr, Priority: b.Priority, Deadline: b.Deadline, Context: b.Context,
		})
		if err != nil {
			errJSON(w, statusFor(err), err.Error())
			return
		}
		writeJSON(w, 201, d)
	}))

	// agents & knowledge graph
	mux.HandleFunc("GET /api/agents", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var a []domain.Agent
		s.store.Read(func(st *data.Store) { a = st.Agents })
		writeJSON(w, 200, a)
	}))
	mux.HandleFunc("GET /api/knowledge-graph", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var kg domain.KnowledgeGraph
		s.store.Read(func(st *data.Store) { kg = st.KnowledgeGraph })
		writeJSON(w, 200, kg)
	}))

	// command (One Prompt)
	mux.HandleFunc("POST /api/command", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Text string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		writeJSON(w, 200, command.Run(s.store, s.audit, s.llm, s.limits, s.user, b.Text))
	}))

	// pulse + SSE
	mux.HandleFunc("GET /api/pulse", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.pulse.Snapshot())
	}))
	mux.HandleFunc("GET /api/pulse/stream", s.authed(s.streamPulse))

	// bot pause/resume (the two-writer control)
	mux.HandleFunc("GET /api/bot", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"paused": s.store.Paused()})
	}))
	mux.HandleFunc("POST /api/bot/pause", s.authed(func(w http.ResponseWriter, r *http.Request) {
		s.store.SetPaused(true)
		s.audit.Append(s.user.Name, s.user.Role, "bot.paused", "heartbeat", "executive paused the bot to make changes")
		writeJSON(w, 200, map[string]any{"paused": true})
	}))
	mux.HandleFunc("POST /api/bot/resume", s.authed(func(w http.ResponseWriter, r *http.Request) {
		s.store.SetPaused(false)
		s.audit.Append(s.user.Name, s.user.Role, "bot.resumed", "heartbeat", "executive resumed the bot")
		s.pulse.Beat(true) // re-read current state and continue immediately
		writeJSON(w, 200, map[string]any{"paused": false})
	}))

	// audit
	mux.HandleFunc("GET /api/audit", s.authed(func(w http.ResponseWriter, r *http.Request) {
		limit := 200
		if q := r.URL.Query().Get("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil {
				limit = n
			}
		}
		writeJSON(w, 200, map[string]any{"integrity": s.audit.Verify(), "events": s.audit.List(limit)})
	}))

	// llm status + cost
	mux.HandleFunc("GET /api/llm/status", s.authed(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, s.llm.Status())
	}))
	mux.HandleFunc("GET /api/llm/cost", s.authed(func(w http.ResponseWriter, r *http.Request) {
		rep := s.llm.Ledger.Report()
		rep["recentCalls"] = s.llm.Ledger.History(20)
		writeJSON(w, 200, rep)
	}))

	// email triage (the real workflow)
	mux.HandleFunc("POST /api/ingest/email", s.authed(s.ingestEmail))

	// local laptop agent — his real apps, mailbox and documents
	s.registerAgent(mux)

	// organizational memory + knowledge (real fabric: graph recall, egress gate)
	s.registerMemory(mux)

	// static UI (SPA) for everything else
	mux.Handle("/", spaFallback(static))
	return mux
}

func (s *Server) streamPulse(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		errJSON(w, 500, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	id, ch := s.pulse.Subscribe()
	defer s.pulse.Unsubscribe(id)
	// send an initial snapshot immediately
	if b, err := json.Marshal(s.pulse.Snapshot()); err == nil {
		fmt.Fprintf(w, "data: %s\n\n", b)
		fl.Flush()
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case snap, ok := <-ch:
			if !ok {
				return
			}
			if b, err := json.Marshal(snap); err == nil {
				fmt.Fprintf(w, "data: %s\n\n", b)
				fl.Flush()
			}
		}
	}
}

func (s *Server) ingestEmail(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("filename")
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n < 200 {
			limit = n
		}
	}
	raw, _ := io.ReadAll(r.Body)
	emails, err := ingest.ParseEmails(string(raw), filename)
	if err != nil {
		errJSON(w, 400, err.Error())
		return
	}
	if len(emails) > limit {
		emails = emails[:limit]
	}
	if r.URL.Query().Get("dryRun") == "true" {
		sample := emails
		if len(sample) > 3 {
			sample = sample[:3]
		}
		var s3 []map[string]string
		for _, e := range sample {
			bp := e.Body
			if len(bp) > 120 {
				bp = bp[:120]
			}
			s3 = append(s3, map[string]string{"from": e.From, "subject": e.Subject, "bodyPreview": bp})
		}
		writeJSON(w, 200, map[string]any{
			"dryRun": true, "parsed": len(emails), "wouldTriage": len(emails),
			"estimatedCostUsd": float64(len(emails)) * 0.00017, "sample": s3,
		})
		return
	}
	if !s.llm.Configured() {
		errJSON(w, 503, "No LLM configured — triage needs a real model. Set EIOS_LLM_BASE_URL. Use ?dryRun=true to verify parsing.")
		return
	}
	results, errs, cost := ingest.TriageBatch(s.llm, emails)
	// Real triaged mail replaces the demo signals — the queue becomes his inbox.
	s.store.Write(func(st *data.Store) {
		var sigs []domain.Signal
		for _, r := range results {
			sigs = append(sigs, ingest.ToSignal(r))
		}
		st.Signals = sigs
	})
	s.pulse.Beat(true)
	writeJSON(w, 200, map[string]any{
		"parsed": len(emails), "triaged": len(results), "errors": errs,
		"totalCostUsd": cost, "budget": s.llm.Ledger.Report(),
		"stats": ingest.Stats(results), "results": ingest.ResultsDTO(results),
	})
}

// spaFallback serves static assets, falling back to index.html for client routes.
func spaFallback(static http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		static.ServeHTTP(w, r)
	})
}
