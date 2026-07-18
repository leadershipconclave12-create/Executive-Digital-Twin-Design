// Package meetings is the meeting twin: it attends meetings so he doesn't.
//
// The lifecycle of one meeting, end to end:
//
//	scheduled ── prep ──> live ──> processing ──> briefed
//	   │           │        │           │             │
//	   │           │        │           │             └─ knowledge committed to the
//	   │           │        │           │                memory fabric; actions
//	   │           │        │           │                delegated to other agents
//	   │           │        │           └─ minutes: decisions, actions, risks
//	   │           │        └─ transcript streaming in; the twin answers questions
//	   │           │           AS HIM, grounded in organizational memory — it
//	   │           │           declines what memory cannot support
//	   │           └─ prep pack assembled from memory: lessons, open decisions,
//	   │              what happened last time with these people
//	   └─ synced from his real Outlook calendar
//
// Where the transcript comes from, honestly: Teams saves live transcripts as
// .vtt files into the synced OneDrive folder when transcription is on — one
// click by any attendee. DiscoverTranscripts finds them and ingests them with
// no admin, no Graph, no bot registration. A Graph bot that literally joins the
// call is Lane B; everything downstream of the transcript is already here.
package meetings

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"eios/internal/llm"
	"eios/internal/memory"
)

// Utterance is one thing one person said.
type Utterance struct {
	Speaker string `json:"speaker"`
	Text    string `json:"text"`
	At      string `json:"at,omitempty"`
}

// PrepPack is what the twin walks in knowing.
type PrepPack struct {
	Headline      string   `json:"headline"`
	History       []string `json:"history"`       // what memory holds about this subject
	Lessons       []string `json:"lessons"`       // rules that apply, with their scars
	OpenDecisions []string `json:"openDecisions"` // decisions whose revisit conditions matter here
	Stance        []string `json:"stance"`        // how HE tends to decide (judgment nodes)
}

// Minutes is the structured outcome of a meeting.
type Minutes struct {
	Summary   string   `json:"summary"`
	Decisions []string `json:"decisions"`
	Actions   []string `json:"actions"`
	Risks     []string `json:"risks"`
	Questions []string `json:"questions"` // asked but not answered — need him
	Method    string   `json:"method"`    // "model" | "rules" — never dressed up
}

// Briefing is the handover after the meeting: what was stored, who was told.
type Briefing struct {
	Text        string   `json:"text"`
	MemoryIDs   []string `json:"memoryIds"`
	DelegatedTo []string `json:"delegatedTo"`
	At          string   `json:"at"`
}

// Session is one meeting the twin is covering.
type Session struct {
	ID         string      `json:"id"`
	Subject    string      `json:"subject"`
	Organizer  string      `json:"organizer"`
	Start      string      `json:"start"`
	End        string      `json:"end,omitempty"`
	IsTeams    bool        `json:"isTeams"`
	Status     string      `json:"status"` // scheduled | prep | live | processing | briefed
	Prep       *PrepPack   `json:"prep,omitempty"`
	Transcript []Utterance `json:"transcript"`
	Minutes    *Minutes    `json:"minutes,omitempty"`
	Briefing   *Briefing   `json:"briefing,omitempty"`
	Source     string      `json:"source"` // calendar | manual | transcript-file
	Note       string      `json:"note,omitempty"`
}

// MeetingInfo is the calendar-shaped input (kept local to avoid an agent import).
type MeetingInfo struct {
	Subject   string
	Organizer string
	Start     string
	End       string
	IsTeams   bool
}

// Engine owns the sessions and their pipeline.
type Engine struct {
	mu     sync.Mutex
	seq    int
	byID   map[string]*Session
	order  []string
	fabric *memory.Fabric
	llm    *llm.Provider
}

func NewEngine(f *memory.Fabric, p *llm.Provider) *Engine {
	return &Engine{byID: map[string]*Session{}, fabric: f, llm: p}
}

// SyncCalendar creates sessions for meetings the twin hasn't seen yet.
// Matching is by subject+start so re-syncing is idempotent.
func (e *Engine) SyncCalendar(meetings []MeetingInfo) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	added := 0
	for _, m := range meetings {
		if m.Subject == "" {
			continue
		}
		dup := false
		for _, s := range e.byID {
			if s.Subject == m.Subject && s.Start == m.Start {
				dup = true
				break
			}
		}
		if dup {
			continue
		}
		e.addLocked(&Session{
			Subject: m.Subject, Organizer: m.Organizer, Start: m.Start, End: m.End,
			IsTeams: m.IsTeams, Status: "scheduled", Source: "calendar",
		})
		added++
	}
	return added
}

// Create adds a manual session (a meeting not on the calendar, or a test).
func (e *Engine) Create(subject, organizer, start string) *Session {
	e.mu.Lock()
	defer e.mu.Unlock()
	if start == "" {
		start = time.Now().UTC().Format(time.RFC3339)
	}
	s := &Session{Subject: subject, Organizer: organizer, Start: start,
		Status: "scheduled", Source: "manual"}
	e.addLocked(s)
	return s
}

func (e *Engine) addLocked(s *Session) {
	e.seq++
	s.ID = fmt.Sprintf("MTG-%d", e.seq)
	if s.Transcript == nil {
		s.Transcript = []Utterance{}
	}
	e.byID[s.ID] = s
	e.order = append(e.order, s.ID)
}

// List returns sessions newest-start first.
func (e *Engine) List() []Session {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]Session, 0, len(e.order))
	for _, id := range e.order {
		out = append(out, *e.byID[id])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Start > out[j].Start })
	return out
}

func (e *Engine) Get(id string) (*Session, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s, ok := e.byID[id]
	return s, ok
}

// Prepare assembles the prep pack from the memory fabric — free, no model call,
// and it cannot invent history that isn't there.
func (e *Engine) Prepare(id string) (*Session, error) {
	e.mu.Lock()
	s, ok := e.byID[id]
	e.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("no session %s", id)
	}

	terms := words(s.Subject)
	pack := &PrepPack{}
	for _, n := range e.fabric.Search(s.Subject, memory.HumanAccess) {
		line := n.Title
		if n.Summary != "" {
			line += " — " + n.Summary
		}
		pack.History = append(pack.History, line)
		if len(pack.History) >= 6 {
			break
		}
	}
	for _, l := range e.fabric.LessonsFor(terms, memory.HumanAccess) {
		pack.Lessons = append(pack.Lessons, l.Rule+" (scar: "+l.Scar+")")
	}
	for _, d := range e.fabric.ByKind("decision", memory.HumanAccess) {
		if d.RevisitCondition != "" {
			pack.OpenDecisions = append(pack.OpenDecisions,
				d.Title+" — revisit when: "+d.RevisitCondition)
		}
	}
	for _, j := range e.fabric.JudgmentsFor(terms, memory.HumanAccess) {
		pack.Stance = append(pack.Stance, "When "+j.Trigger+", he "+j.Judgment+" — because "+j.Because)
	}
	switch {
	case len(pack.History) == 0 && len(pack.Lessons) == 0:
		pack.Headline = "No organizational history on this subject — the twin will listen, not assert."
	default:
		pack.Headline = fmt.Sprintf("%d relevant record(s), %d applicable lesson(s).",
			len(pack.History), len(pack.Lessons))
	}

	e.mu.Lock()
	s.Prep = pack
	if s.Status == "scheduled" {
		s.Status = "prep"
	}
	e.mu.Unlock()
	return s, nil
}

// Ingest appends transcript utterances and marks the session live.
func (e *Engine) Ingest(id string, utts []Utterance) (*Session, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s, ok := e.byID[id]
	if !ok {
		return nil, fmt.Errorf("no session %s", id)
	}
	s.Transcript = append(s.Transcript, utts...)
	if s.Status == "scheduled" || s.Status == "prep" {
		s.Status = "live"
	}
	return s, nil
}

// Answer is the twin speaking AS HIM in the room. It grounds every reply in the
// memory fabric plus what has been said so far, and declines what it cannot
// support — a wrong answer in his voice is the unforgivable failure.
type TwinAnswer struct {
	Question   string   `json:"question"`
	Answer     string   `json:"answer"`
	Grounded   bool     `json:"grounded"`
	Basis      []string `json:"basis"`
	Confidence string   `json:"confidence"`
	Method     string   `json:"method"` // "memory" | "model+memory" | "declined"
}

func (e *Engine) Answer(id, question string) TwinAnswer {
	e.mu.Lock()
	s, ok := e.byID[id]
	var transcript []Utterance
	var subject string
	if ok {
		transcript = append(transcript, s.Transcript...)
		subject = s.Subject
	}
	e.mu.Unlock()

	// Structure first: what does organizational memory actually hold?
	rec := e.fabric.Recall(question, memory.LLMAccess)
	basis := []string{}
	for _, b := range rec.Basis {
		basis = append(basis, b.NodeID)
	}

	// With a model: compose a reply in his register, strictly from the recall +
	// the room so far. Without one: return the structural recall itself.
	if e.llm != nil && e.llm.Configured() {
		var room strings.Builder
		for i := len(transcript) - 1; i >= 0 && room.Len() < 4000; i-- {
			room.WriteString(transcript[i].Speaker + ": " + transcript[i].Text + "\n")
		}
		sys := "You are the digital twin of a Deputy Chief of Products (UPI/IMPS, Indian retail payments), " +
			"attending the meeting '" + subject + "' on his behalf. Answer the question in his voice: brief, direct, decisive. " +
			"Use ONLY the organizational memory and the meeting transcript below. If they do not support an answer, " +
			"say you will take it back to him — NEVER invent facts, numbers or commitments. " +
			"Never commit to spending, deadlines or approvals: those remain his alone.\n\n" +
			"ORGANIZATIONAL MEMORY:\n" + rec.AnswerText + "\n\nMEETING SO FAR:\n" + room.String()
		reply, _, err := e.llm.Complete(e.llm.ModelFor("reason"), "meeting-answer",
			[]llm.Message{{Role: "system", Content: sys}, {Role: "user", Content: question}}, 0.2, 400)
		if err == nil && strings.TrimSpace(reply) != "" {
			return TwinAnswer{Question: question, Answer: strings.TrimSpace(reply),
				Grounded: len(basis) > 0, Basis: basis, Confidence: rec.Confidence, Method: "model+memory"}
		}
	}

	if rec.Confidence == "low" || len(basis) == 0 {
		return TwinAnswer{Question: question,
			Answer:     "I don't have a reliable record on that — I'll take it back to him and revert today.",
			Grounded:   false, Basis: []string{}, Confidence: "low", Method: "declined"}
	}
	return TwinAnswer{Question: question, Answer: rec.AnswerText,
		Grounded: true, Basis: basis, Confidence: rec.Confidence, Method: "memory"}
}

// Finalize turns the transcript into minutes. With a model it asks for the
// structure; without one it extracts by rule. Method is reported either way.
func (e *Engine) Finalize(id string) (*Session, error) {
	e.mu.Lock()
	s, ok := e.byID[id]
	if !ok {
		e.mu.Unlock()
		return nil, fmt.Errorf("no session %s", id)
	}
	if len(s.Transcript) == 0 {
		e.mu.Unlock()
		return nil, fmt.Errorf("no transcript yet — nothing to minute")
	}
	transcript := append([]Utterance{}, s.Transcript...)
	subject := s.Subject
	s.Status = "processing"
	e.mu.Unlock()

	var m *Minutes
	if e.llm != nil && e.llm.Configured() {
		m = e.minutesByModel(subject, transcript)
	}
	if m == nil {
		m = minutesByRules(subject, transcript)
	}

	e.mu.Lock()
	s.Minutes = m
	e.mu.Unlock()
	return s, nil
}

func (e *Engine) minutesByModel(subject string, ts []Utterance) *Minutes {
	var b strings.Builder
	for _, u := range ts {
		b.WriteString(u.Speaker + ": " + u.Text + "\n")
		if b.Len() > 24000 {
			break
		}
	}
	sys := "You minute executive meetings for an Indian payments organization. From the transcript, extract:\n" +
		"SUMMARY: <=3 sentences.\nDECISIONS: each on a line starting 'D: '\nACTIONS: each 'A: <owner>: <action>'\n" +
		"RISKS: each 'R: '\nQUESTIONS (unresolved, need the Deputy Chief): each 'Q: '\n" +
		"Only what was actually said. No invention."
	out, _, err := e.llm.Complete(e.llm.ModelFor("brief"), "meeting-minutes",
		[]llm.Message{{Role: "system", Content: sys},
			{Role: "user", Content: "Meeting: " + subject + "\n\n" + b.String()}}, 0.1, 900)
	if err != nil || strings.TrimSpace(out) == "" {
		return nil
	}
	m := &Minutes{Method: "model"}
	for _, ln := range strings.Split(out, "\n") {
		ln = strings.TrimSpace(ln)
		switch {
		case strings.HasPrefix(ln, "D: "):
			m.Decisions = append(m.Decisions, ln[3:])
		case strings.HasPrefix(ln, "A: "):
			m.Actions = append(m.Actions, ln[3:])
		case strings.HasPrefix(ln, "R: "):
			m.Risks = append(m.Risks, ln[3:])
		case strings.HasPrefix(ln, "Q: "):
			m.Questions = append(m.Questions, ln[3:])
		case strings.HasPrefix(ln, "SUMMARY:"):
			m.Summary = strings.TrimSpace(ln[8:])
		case m.Summary != "" && len(m.Decisions)+len(m.Actions)+len(m.Risks)+len(m.Questions) == 0 && ln != "":
			m.Summary += " " + ln
		}
	}
	if m.Summary == "" && len(m.Decisions) == 0 && len(m.Actions) == 0 {
		return nil // model produced nothing usable — fall back rather than store mush
	}
	return m
}

// minutesByRules is the no-model fallback: crude, honest, and labelled as such.
func minutesByRules(subject string, ts []Utterance) *Minutes {
	m := &Minutes{Method: "rules"}
	decideWords := []string{"we've decided", "we decided", "agreed to", "we agree", "approved", "sign off", "signed off", "go ahead with"}
	actionWords := []string{"will ", "i'll ", "we'll ", "by friday", "by monday", "by tomorrow", "next week", "action:", "take this away", "follow up"}
	riskWords := []string{"risk", "concern", "worried", "blocker", "blocked", "slip", "delay", "breach", "exposure"}
	for _, u := range ts {
		low := strings.ToLower(u.Text)
		line := u.Speaker + ": " + u.Text
		switch {
		case containsAny(low, decideWords):
			m.Decisions = append(m.Decisions, line)
		case strings.Contains(u.Text, "?"):
			m.Questions = append(m.Questions, line)
		case containsAny(low, riskWords):
			m.Risks = append(m.Risks, line)
		case containsAny(low, actionWords):
			m.Actions = append(m.Actions, line)
		}
	}
	m.Summary = fmt.Sprintf("%s — %d utterances; %d decision(s), %d action(s), %d risk(s), %d open question(s). Extracted by rules (no model); verify before relying on it.",
		subject, len(ts), len(m.Decisions), len(m.Actions), len(m.Risks), len(m.Questions))
	return m
}

// Brief is the handover: minutes become memory (an episode node per decision,
// linked to the meeting), and the caller receives the actions to delegate.
// The knowledge outlives the meeting; next quarter's "what did we agree with
// AxisPay?" is answered from structure.
func (e *Engine) Brief(id string) (*Session, error) {
	e.mu.Lock()
	s, ok := e.byID[id]
	if !ok {
		e.mu.Unlock()
		return nil, fmt.Errorf("no session %s", id)
	}
	if s.Minutes == nil {
		e.mu.Unlock()
		return nil, fmt.Errorf("finalize the minutes before briefing")
	}
	sess := *s
	e.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	conf := 0.75 // transcript-derived, not human-validated yet
	prov := memory.Provenance{
		Source: "meeting transcript — " + sess.Subject, RecordedAt: now,
		RecordedBy: "meeting-twin", Confidence: memory.Derived,
	}
	var ids []string

	epID := "MEP-" + sess.ID
	e.fabric.Add(memory.Node{
		ID: epID, Kind: "episode", Title: "Meeting: " + sess.Subject, At: sess.Start,
		Summary: sess.Minutes.Summary, Tags: words(sess.Subject),
		Provenance: prov, Sensitivity: memory.Open, Layer: "organizational", Lifecycle: "active",
		Confidence: memory.ConfidenceDetail{Evidence: 0.8, Reasoning: 0.7, Policy: 1, Freshness: 1,
			HumanValidation: "unvalidated", Overall: conf, LimitedBy: "validation",
			Explanation: "Derived from a meeting transcript; he has not yet confirmed it."},
		EntityRef: sess.Subject,
	})
	ids = append(ids, epID)

	for i, d := range sess.Minutes.Decisions {
		did := fmt.Sprintf("MDC-%s-%d", sess.ID, i+1)
		e.fabric.Add(memory.Node{
			ID: did, Kind: "decision", Title: "In-meeting: " + trim(d, 90), At: sess.Start,
			Summary: d, Tags: words(sess.Subject), Provenance: prov,
			Sensitivity: memory.Open, Layer: "organizational", Lifecycle: "active",
			Confidence: memory.ConfidenceDetail{Evidence: 0.8, Reasoning: 0.7, Policy: 1, Freshness: 1,
				HumanValidation: "unvalidated", Overall: conf, LimitedBy: "validation",
				Explanation: "Stated in the meeting; awaiting his confirmation."},
			EntityRef: sess.Subject,
		})
		e.fabric.Link(did, "about", epID)
		ids = append(ids, did)
	}

	var text strings.Builder
	fmt.Fprintf(&text, "Covered '%s' for you. %s", sess.Subject, sess.Minutes.Summary)
	if n := len(sess.Minutes.Questions); n > 0 {
		fmt.Fprintf(&text, " %d question(s) genuinely need you.", n)
	}

	e.mu.Lock()
	s.Briefing = &Briefing{Text: text.String(), MemoryIDs: ids, At: now}
	s.Status = "briefed"
	e.mu.Unlock()
	return s, nil
}

// --- helpers ---------------------------------------------------------------

func containsAny(s string, subs []string) bool {
	for _, x := range subs {
		if strings.Contains(s, x) {
			return true
		}
	}
	return false
}

func trim(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func words(s string) []string {
	var out []string
	for _, w := range strings.Fields(strings.ToLower(s)) {
		w = strings.Trim(w, ".,;:!?\"'()[]")
		if len(w) > 2 {
			out = append(out, w)
		}
	}
	return out
}
