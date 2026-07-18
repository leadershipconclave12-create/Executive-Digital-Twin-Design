package meetings

import (
	"strings"
	"testing"

	"eios/internal/memory"
)

const sampleVTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Ravi Kumar>We're worried about the AxisPay SLA breach again.</v>

2
00:00:05.000 --> 00:00:09.000
<v Sourabh Twin>The record shows this is the third breach this quarter.</v>

3
00:00:10.000 --> 00:00:14.000
<v Ravi Kumar>Agreed to issue the contractual notice this week.</v>

4
00:00:15.000 --> 00:00:18.000
<v Priya Shah>I'll draft the notice by Friday.</v>

5
00:00:19.000 --> 00:00:21.000
<v Ravi Kumar>Who signs off on the penalty amount?</v>
`

func TestParseVTT(t *testing.T) {
	utts := ParseTranscript(sampleVTT)
	if len(utts) != 5 {
		t.Fatalf("expected 5 utterances, got %d", len(utts))
	}
	if utts[0].Speaker != "Ravi Kumar" {
		t.Errorf("speaker parsing broke: %q", utts[0].Speaker)
	}
	if !strings.Contains(utts[3].Text, "by Friday") {
		t.Errorf("text parsing broke: %q", utts[3].Text)
	}
	if utts[0].At == "" {
		t.Error("expected cue timestamps to be kept")
	}
}

func TestParsePlain(t *testing.T) {
	utts := ParseTranscript("Ravi: hello there\nPriya: we agreed to ship\nand it continues here")
	if len(utts) != 2 {
		t.Fatalf("expected 2 utterances (continuation merged), got %d", len(utts))
	}
	if !strings.Contains(utts[1].Text, "continues here") {
		t.Error("continuation line was not merged into the previous speaker")
	}
}

// The full lifecycle without a model: sync → prep → ingest → finalize → brief.
func TestLifecycleRulesOnly(t *testing.T) {
	f := memory.Seed()
	e := NewEngine(f, nil)

	added := e.SyncCalendar([]MeetingInfo{{Subject: "AxisPay SLA review", Organizer: "Ravi Kumar", Start: "2026-07-18T10:00:00Z", IsTeams: true}})
	if added != 1 {
		t.Fatalf("expected 1 session, got %d", added)
	}
	if again := e.SyncCalendar([]MeetingInfo{{Subject: "AxisPay SLA review", Organizer: "Ravi Kumar", Start: "2026-07-18T10:00:00Z"}}); again != 0 {
		t.Errorf("re-sync must be idempotent, added %d", again)
	}
	s := e.List()[0]

	// prep pulls from the fabric — the vendor-SLA judgment should surface
	prepped, err := e.Prepare(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if prepped.Prep == nil || prepped.Prep.Headline == "" {
		t.Fatal("expected a prep pack")
	}

	if _, err := e.Ingest(s.ID, ParseTranscript(sampleVTT)); err != nil {
		t.Fatal(err)
	}
	fin, err := e.Finalize(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fin.Minutes.Method != "rules" {
		t.Errorf("no model configured — method must say 'rules', got %q", fin.Minutes.Method)
	}
	if len(fin.Minutes.Decisions) == 0 {
		t.Error("expected the 'Agreed to issue the contractual notice' decision")
	}
	if len(fin.Minutes.Actions) == 0 {
		t.Error("expected Priya's Friday action")
	}
	if len(fin.Minutes.Questions) == 0 {
		t.Error("expected the sign-off question to be flagged for him")
	}

	briefed, err := e.Brief(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if briefed.Status != "briefed" || len(briefed.Briefing.MemoryIDs) < 2 {
		t.Fatalf("expected episode+decision nodes in memory, got %v", briefed.Briefing)
	}
	// The knowledge must actually be recallable afterwards.
	ep, ok := f.Get(briefed.Briefing.MemoryIDs[0], memory.HumanAccess)
	if !ok {
		t.Fatal("briefed episode is not in the fabric")
	}
	if ep.Provenance.Confidence != memory.Derived {
		t.Error("meeting-derived knowledge must be marked derived, not stated")
	}
	if ep.Confidence.HumanValidation != "unvalidated" {
		t.Error("unconfirmed minutes must not claim validation")
	}
}

// A twin that guesses in his voice is worse than no twin.
func TestAnswerDeclinesWithoutRecord(t *testing.T) {
	f := memory.Seed()
	e := NewEngine(f, nil)
	s := e.Create("Antarctic expansion sync", "", "")
	a := e.Answer(s.ID, "what did we budget for the Antarctic branch?")
	if a.Method != "declined" {
		t.Fatalf("expected a decline, got method %q: %s", a.Method, a.Answer)
	}
	if !strings.Contains(a.Answer, "take it back") {
		t.Errorf("the decline must promise to bring it to him: %q", a.Answer)
	}
}

// With a record, the no-model answer comes from structure.
func TestAnswerFromMemory(t *testing.T) {
	f := memory.Seed()
	e := NewEngine(f, nil)
	s := e.Create("XYZ Bank partnership revisit", "", "")
	a := e.Answer(s.ID, "Why did we reject XYZ Bank's proposal?")
	if a.Method != "memory" || !a.Grounded {
		t.Fatalf("expected a grounded memory answer, got %+v", a)
	}
	if len(a.Basis) == 0 {
		t.Error("expected traceable basis IDs")
	}
}

// Case 26: the same transcript ingested twice must not double the record.
func TestReIngestIsDeduplicated(t *testing.T) {
	e := NewEngine(memory.Seed(), nil)
	s := e.Create("Dedup check", "", "")
	utts := ParseTranscript(sampleVTT)
	if _, err := e.Ingest(s.ID, utts); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Ingest(s.ID, utts); err != nil {
		t.Fatal(err)
	}
	got, _ := e.Get(s.ID)
	if len(got.Transcript) != len(utts) {
		t.Fatalf("re-ingest doubled the transcript: %d vs %d", len(got.Transcript), len(utts))
	}
}

// Cases 32/36: "scratch that" voids the decision it follows.
func TestRetractionVoidsDecision(t *testing.T) {
	m := minutesByRules("Retraction", []Utterance{
		{Speaker: "Ravi", Text: "Agreed to extend the AxisPay contract."},
		{Speaker: "Ravi", Text: "Actually no, scratch that until the penalty is settled."},
		{Speaker: "Priya", Text: "Agreed to issue the penalty notice first."},
	})
	if len(m.Decisions) != 1 {
		t.Fatalf("expected the retracted decision removed, got %v", m.Decisions)
	}
	if !strings.Contains(m.Decisions[0], "penalty notice") {
		t.Errorf("the surviving decision should be the final position: %v", m.Decisions)
	}
}

// Cases 73–78: a meeting that touched comp/legal/pricing is stored Restricted —
// he reads it; the egress gate keeps it out of every prompt.
func TestSensitiveMeetingIsRestricted(t *testing.T) {
	f := memory.Seed()
	e := NewEngine(f, nil)
	s := e.Create("Team discussion", "", "")
	_, _ = e.Ingest(s.ID, []Utterance{
		{Speaker: "Ravi", Text: "Agreed to revise the salary bands for the platform team."},
		{Speaker: "Priya", Text: "I'll prepare the increment sheet by Friday."},
	})
	if _, err := e.Finalize(s.ID); err != nil {
		t.Fatal(err)
	}
	briefed, err := e.Brief(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range briefed.Briefing.MemoryIDs {
		n, ok := f.Get(id, memory.HumanAccess)
		if !ok {
			t.Fatalf("node %s missing", id)
		}
		if n.Sensitivity != memory.Restricted {
			t.Errorf("%s: a salary discussion must be Restricted, got %q", id, n.Sensitivity)
		}
		if _, visible := f.Get(id, memory.LLMAccess); visible {
			t.Errorf("%s must be invisible to LLMAccess", id)
		}
	}
	if !strings.Contains(briefed.Briefing.Text, "RESTRICTED") {
		t.Error("the briefing must tell him the record was restricted")
	}
	// A clean commercial meeting stays Open.
	s2 := e.Create("Release 18 readiness", "", "")
	_, _ = e.Ingest(s2.ID, []Utterance{
		{Speaker: "Ravi", Text: "Agreed to move the release gate to Thursday."},
		{Speaker: "Dev", Text: "I'll update the runbook by tomorrow."},
	})
	_, _ = e.Finalize(s2.ID)
	b2, _ := e.Brief(s2.ID)
	n, _ := f.Get(b2.Briefing.MemoryIDs[0], memory.HumanAccess)
	if n.Sensitivity != memory.Open {
		t.Errorf("an ordinary release meeting should stay Open, got %q", n.Sensitivity)
	}
}

func TestFinalizeWithoutTranscript(t *testing.T) {
	e := NewEngine(memory.Seed(), nil)
	s := e.Create("Empty", "", "")
	if _, err := e.Finalize(s.ID); err == nil {
		t.Error("finalizing an empty transcript must refuse, not fabricate minutes")
	}
}
