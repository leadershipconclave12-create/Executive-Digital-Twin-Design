// EIOS — Executive Intelligence Operating System, Go edition.
// A single lightweight binary: HTTP API + embedded UI + organizational heartbeat.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"eios/internal/agent"
	"eios/internal/api"
	"eios/internal/config"
	"eios/internal/data"
	"eios/internal/governance"
	"eios/internal/llm"
	"eios/internal/memory"
	"eios/internal/twin"
)

//go:embed all:web
var webFS embed.FS

func staticHandler() http.Handler {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	index, _ := fs.ReadFile(sub, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// API is handled elsewhere; here we serve assets, SPA-falling-back to index.
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(sub, p); err != nil {
			// unknown client route → index.html (SPA)
			w.Header().Set("content-type", "text/html; charset=utf-8")
			_, _ = w.Write(index)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func main() {
	// Load config. Prefer a local .env; fall back to the prototype's .env so an
	// already-configured LLM key is reused without duplication.
	config.LoadDotEnv(".env")
	config.LoadDotEnv("../eios-prototype/.env")
	cfg := config.Load()

	store := data.NewStore()
	audit := governance.NewAuditLog()
	audit.Append("EIOS", "system", "system.boot", "eios", "Organizational operating system started")
	provider := llm.New(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMSmallModel, cfg.LLMFrontierModel, cfg.LLMBudgetUSD)
	pulse := twin.NewPulse(store)

	// The local agent: watches which app he's actually in. Read-only, no admin.
	ag := agent.New()
	ag.Watch(2 * time.Second)

	// The memory fabric: provenance-traced organizational knowledge. Free recall
	// from graph structure — no model call, cannot hallucinate.
	mem := memory.Seed()

	srv := api.NewServer(cfg, store, audit, pulse, provider, ag, mem)
	handler := srv.Handler(staticHandler())

	pulse.Start(4 * time.Second)

	addr := fmt.Sprintf(":%d", cfg.Port)
	access := "LOCALHOST ONLY — no EIOS_ACCESS_TOKEN set; remote requests are refused"
	if cfg.AccessToken != "" {
		access = "token required — safe to expose"
	}
	reasoning := "rules only (set EIOS_LLM_BASE_URL for real reasoning)"
	if provider.Configured() {
		reasoning = "REAL — " + cfg.LLMSmallModel + " (triage) / " + cfg.LLMFrontierModel + " (reasoning)"
	}
	log.Printf("EIOS (Go) listening on http://localhost%s\n"+
		"  Reasoning       : %s\n"+
		"  Autonomous limit: ₹%d (ADR-003)\n"+
		"  Access          : %s\n"+
		"  Pulse           : beating every 4s (GET /api/pulse, stream /api/pulse/stream)\n"+
		"  Pause control   : POST /api/bot/pause · /api/bot/resume",
		addr, reasoning, cfg.AutonomousFinancialLimitInr, access)

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}
