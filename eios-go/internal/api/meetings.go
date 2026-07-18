package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"eios/internal/agent"
	"eios/internal/llm"
	"eios/internal/meetings"
	"eios/internal/memory"
	"eios/internal/services"
)

// The meeting twin + document study + grounded responder + the composite
// "present everywhere" view. This is the 90%-offload surface: meetings covered,
// documents read, replies drafted — with his voice guarded by memory, and the
// send/approve/spend buttons left firmly with him.

func (s *Server) registerMeetings(mux *http.ServeMux) {
	// Sessions. GET also syncs new meetings in from the real calendar (cheap,
	// idempotent) so his day appears without a single click.
	mux.HandleFunc("GET /api/meetings", s.authed(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("sync") != "false" {
			if day := agent.ReadDay(1); day.Available {
				var infos []meetings.MeetingInfo
				for _, ev := range day.Events {
					if ev.AllDay {
						continue
					}
					infos = append(infos, meetings.MeetingInfo{Subject: ev.Subject,
						Organizer: ev.Organizer, Start: ev.Start, End: ev.End, IsTeams: ev.IsTeams})
				}
				s.meetings.SyncCalendar(infos)
			}
		}
		writeJSON(w, 200, s.meetings.List())
	}))

	mux.HandleFunc("POST /api/meetings", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Subject, Organizer, Start string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Subject) == "" {
			errJSON(w, 400, "a meeting needs a subject")
			return
		}
		writeJSON(w, 201, s.meetings.Create(b.Subject, b.Organizer, b.Start))
	}))

	mux.HandleFunc("POST /api/meetings/{id}/prepare", s.authed(func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.meetings.Prepare(r.PathValue("id"))
		if err != nil {
			errJSON(w, 404, err.Error())
			return
		}
		writeJSON(w, 200, sess)
	}))

	// Transcript intake: raw text (pasted or VTT) in the body.
	mux.HandleFunc("POST /api/meetings/{id}/transcript", s.authed(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
		utts := meetings.ParseTranscript(string(raw))
		if len(utts) == 0 {
			errJSON(w, 400, "no utterances found — paste 'Name: text' lines or a Teams .vtt")
			return
		}
		sess, err := s.meetings.Ingest(r.PathValue("id"), utts)
		if err != nil {
			errJSON(w, 404, err.Error())
			return
		}
		writeJSON(w, 200, sess)
	}))

	// The twin answering in the room, as him, grounded or declining.
	mux.HandleFunc("POST /api/meetings/{id}/ask", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Question string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Question) == "" {
			errJSON(w, 400, "ask a question")
			return
		}
		ans := s.meetings.Answer(r.PathValue("id"), b.Question)
		// Everything the twin says in a room, in his voice, is on the record.
		s.audit.Append("EIOS Twin", "meeting_twin", "meeting.answered", r.PathValue("id"),
			"Q: "+b.Question+" | method="+ans.Method+" grounded="+strconv.FormatBool(ans.Grounded)+
				" | A: "+ans.Answer)
		writeJSON(w, 200, ans)
	}))

	mux.HandleFunc("POST /api/meetings/{id}/finalize", s.authed(func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.meetings.Finalize(r.PathValue("id"))
		if err != nil {
			errJSON(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, sess)
	}))

	// Brief: knowledge into the fabric; each action delegated to its owner (L1 —
	// informational authority; spend stays his); everything audited.
	mux.HandleFunc("POST /api/meetings/{id}/brief", s.authed(func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.meetings.Brief(r.PathValue("id"))
		if err != nil {
			errJSON(w, 400, err.Error())
			return
		}
		var delegated []string
		if sess.Minutes != nil {
			for _, a := range sess.Minutes.Actions {
				owner, task := splitAction(a)
				d, derr := services.CreateDelegation(s.store, s.audit, services.NewDelegation{
					User: s.user, Delegate: owner, Subject: task, AuthorityLevel: "L1",
					Priority: "Medium", Deadline: "EOD",
					Context: "From meeting '" + sess.Subject + "' (" + sess.ID + "), covered by the twin.",
				})
				if derr == nil {
					delegated = append(delegated, owner+" — "+d.ID)
				}
			}
		}
		sess.Briefing.DelegatedTo = delegated
		s.audit.Append("EIOS Twin", "meeting_twin", "meeting.briefed", sess.ID,
			"covered '"+sess.Subject+"': "+strconv.Itoa(len(sess.Briefing.MemoryIDs))+
				" record(s) stored, "+strconv.Itoa(len(delegated))+" action(s) delegated")
		s.pulse.Beat(true)
		writeJSON(w, 200, sess)
	}))

	// Teams .vtt transcripts already synced to disk — the no-Graph bridge.
	mux.HandleFunc("GET /api/meetings/transcripts", s.authed(func(w http.ResponseWriter, r *http.Request) {
		files := meetings.DiscoverTranscripts()
		writeJSON(w, 200, map[string]any{"count": len(files), "files": files,
			"how": "Turn on transcription in Teams; the .vtt lands in OneDrive and appears here."})
	}))
	mux.HandleFunc("POST /api/meetings/ingest-file", s.authed(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ ID, Path string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if b.Path == "" {
			errJSON(w, 400, "pass the transcript file path")
			return
		}
		sess, err := s.meetings.IngestFile(b.ID, b.Path)
		if err != nil {
			errJSON(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, sess)
	}))

	// --- document study -----------------------------------------------------
	mux.HandleFunc("POST /api/study/scan", s.authed(func(w http.ResponseWriter, r *http.Request) {
		limit := 30
		if q := r.URL.Query().Get("limit"); q != "" {
			if n, err := strconv.Atoi(q); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		rep := s.study.Scan(limit, r.URL.Query().Get("com") == "true")
		s.audit.Append("EIOS Twin", "study_engine", "docs.studied", "local-files",
			"studied "+strconv.Itoa(rep.Studied)+" document(s) into memory")
		writeJSON(w, 200, rep)
	}))

	// --- grounded responder (mail / Teams messages) -------------------------
	mux.HandleFunc("POST /api/respond", s.authed(s.respond))

	// --- present everywhere -------------------------------------------------
	mux.HandleFunc("GET /api/presence", s.authed(func(w http.ResponseWriter, r *http.Request) {
		sessions := s.meetings.List()
		var live, briefed int
		for _, m := range sessions {
			switch m.Status {
			case "live":
				live++
			case "briefed":
				briefed++
			}
		}
		var unhandled int
		for _, sig := range services.ListSignals(s.store) {
			if !sig.Handled {
				unhandled++
			}
		}
		writeJSON(w, 200, map[string]any{
			"meetings": map[string]any{"total": len(sessions), "liveNow": live, "briefed": briefed},
			"documentsStudied": s.study.Count(),
			"inboxOpen":        unhandled,
			"memory":           s.memory.Stats(),
			"reasoning":        s.llm.Configured(),
			"activity":         s.agent.Snapshot(),
		})
	}))
}

// respond drafts a reply to an inbound message in his voice, grounded in memory.
// For mail on a machine with classic Outlook it lands in Drafts; either way the
// text is returned for review. It never sends anything, anywhere.
func (s *Server) respond(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Channel string `json:"channel"` // mail | teams
		From    string `json:"from"`
		Subject string `json:"subject"`
		Body    string `json:"body"`
		ReplyTo string `json:"replyTo"` // Outlook EntryID when replying to real mail
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if strings.TrimSpace(b.Body) == "" && strings.TrimSpace(b.Subject) == "" {
		errJSON(w, 400, "nothing to respond to")
		return
	}

	rec := s.memory.Recall(b.Subject+" "+b.Body, memory.LLMAccess)
	var basis []string
	for _, e := range rec.Basis {
		basis = append(basis, e.NodeID)
	}

	reply, method := "", "template"
	if s.llm.Configured() {
		sys := "You draft replies for a Deputy Chief of Products (UPI/IMPS, NPCI ecosystem). " +
			"Write a short, professional reply in first person, his register: direct, warm, no filler. " +
			"Ground every claim in the organizational memory below; if it doesn't cover something, say he'll come back on it. " +
			"Never approve spend, commit deadlines, or make policy — flag those for him instead.\n\n" +
			"ORGANIZATIONAL MEMORY:\n" + rec.AnswerText
		out, _, err := s.llm.Complete(s.llm.ModelFor("reason"), "respond",
			[]llm.Message{{Role: "system", Content: sys},
				{Role: "user", Content: "Channel: " + b.Channel + "\nFrom: " + b.From + "\nSubject: " + b.Subject + "\n\n" + b.Body}}, 0.3, 500)
		if err == nil && strings.TrimSpace(out) != "" {
			reply, method = strings.TrimSpace(out), "model+memory"
		}
	}
	if reply == "" {
		reply = "Thanks — noted. I'm looking at this now and will come back to you today with a clear answer."
		if rec.Confidence != "low" {
			reply = "Thanks — on this, our record is clear: " + firstSentence(rec.AnswerText) +
				" I'll confirm the details and revert today."
			method = "memory"
		}
	}

	res := map[string]any{
		"reply": reply, "method": method, "grounded": len(basis) > 0, "basis": basis,
		"confidence": rec.Confidence, "sent": false,
		"note": "This is a draft for his review — the twin never sends.",
	}
	if b.Channel == "mail" {
		dr := agent.DraftMail(agent.DraftRequest{To: b.From, Subject: "RE: " + b.Subject, Body: reply, ReplyTo: b.ReplyTo})
		res["outlookDraft"] = dr
		if dr.Created {
			s.audit.Append("EIOS Twin", "responder", "mail.drafted", dr.EntryID,
				"drafted a grounded reply to '"+b.Subject+"' (saved to Drafts, not sent)")
		}
	}
	writeJSON(w, 200, res)
}

func splitAction(a string) (owner, task string) {
	if i := strings.Index(a, ":"); i > 0 && i < 40 {
		return strings.TrimSpace(a[:i]), strings.TrimSpace(a[i+1:])
	}
	return "Unassigned", a
}

func firstSentence(s string) string {
	if i := strings.IndexAny(s, ".!"); i > 0 && i < 300 {
		return s[:i+1]
	}
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
