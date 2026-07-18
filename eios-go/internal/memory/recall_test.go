package memory

import "strings"

import "testing"

// The flagship: this must be answerable from STRUCTURE alone — no model.
func TestRecallXYZBank(t *testing.T) {
	f := Seed()
	a := f.Recall("Why did we reject XYZ Bank's proposal?", HumanAccess)

	if !strings.Contains(a.AnswerText, "D-193") {
		t.Fatalf("expected the decision id D-193 in:\n%s", a.AnswerText)
	}
	if !strings.Contains(a.AnswerText, "March 2026") {
		t.Errorf("expected the date; got:\n%s", a.AnswerText)
	}
	// the full rationale chain, in order
	for _, want := range []string{"Merchant adoption risk", "Fraud concern",
		"Engineering estimate doubled", "Risk Committee approval absent"} {
		if !strings.Contains(a.AnswerText, want) {
			t.Errorf("missing rationale %q", want)
		}
	}
	// his own words, verbatim
	if !strings.Contains(a.AnswerText, "We'll revisit after NPCI publishes the new circular.") {
		t.Error("expected the executive's verbatim quote")
	}
	// alternatives not taken
	if !strings.Contains(a.AnswerText, "White-label") {
		t.Error("expected the white-label alternative")
	}
	// volunteers whether the revisit condition has since been met
	if !strings.Contains(a.AnswerText, "Revisit condition") || !strings.Contains(a.AnswerText, "not been") {
		t.Errorf("expected an unprompted revisit-condition status; got:\n%s", a.AnswerText)
	}
	if a.Confidence != "high" {
		t.Errorf("expected high confidence, got %q", a.Confidence)
	}
	// every claim traceable
	if len(a.Basis) < 5 {
		t.Errorf("expected a traceable basis, got %d entries", len(a.Basis))
	}
	for _, b := range a.Basis {
		if b.NodeID == "" || b.Provenance.Source == "" {
			t.Error("a basis entry lacks provenance")
		}
	}
	// timeline is chronological
	for i := 1; i < len(a.Timeline); i++ {
		if a.Timeline[i-1].At > a.Timeline[i].At {
			t.Error("timeline is not chronological")
		}
	}
}

// Causal chains: outage → customer impact → CEO review.
func TestRecallDiwaliChain(t *testing.T) {
	f := Seed()
	a := f.Recall("what happened during the Diwali outage?", HumanAccess)
	for _, want := range []string{"switch overloaded", "4.2M", "CEO"} {
		if !strings.Contains(a.AnswerText, want) {
			t.Errorf("expected %q in:\n%s", want, a.AnswerText)
		}
	}
	if len(a.Timeline) < 3 {
		t.Errorf("expected a multi-step timeline, got %d", len(a.Timeline))
	}
}

// Memory must surface the rule, not just the story.
func TestLessonsSurface(t *testing.T) {
	f := Seed()
	a := f.Recall("what lessons apply to deploys?", HumanAccess)
	found := false
	for _, l := range a.Lessons {
		if strings.Contains(strings.ToLower(l.Rule), "festival") {
			found = true
			if l.Scar == "" {
				t.Error("a lesson must carry its scar, not just its rule")
			}
		}
	}
	if !found {
		t.Errorf("expected the festival-freeze lesson; got %+v", a.Lessons)
	}
}

// THE UNFORGIVABLE FAILURE would be guessing. It must decline.
func TestRefusesToGuess(t *testing.T) {
	f := Seed()
	a := f.Recall("why did we acquire the Antarctic branch network?", HumanAccess)
	if a.Confidence != "low" {
		t.Errorf("expected low confidence, got %q", a.Confidence)
	}
	if len(a.Basis) != 0 {
		t.Errorf("expected no basis, got %d", len(a.Basis))
	}
	if !strings.Contains(a.AnswerText, "no record") || !strings.Contains(a.AnswerText, "won't guess") {
		t.Errorf("expected an explicit refusal; got:\n%s", a.AnswerText)
	}
	if len(a.Gaps) == 0 {
		t.Error("expected the gap to be named")
	}
}

// THE EGRESS BOUNDARY: he reads his own notes; a model never does.
func TestLLMEgressGate(t *testing.T) {
	f := Seed()

	if _, ok := f.Get("PE-B", HumanAccess); !ok {
		t.Error("the executive must be able to read his own 1:1 notes")
	}
	if _, ok := f.Get("PE-B", LLMAccess); ok {
		t.Error("PERSONAL people-memory must NEVER be visible to a model")
	}
	if _, ok := f.Get("EV-303", LLMAccess); ok {
		t.Error("restricted records (CEO review) must never reach a model")
	}
	if _, ok := f.Get("D-193", LLMAccess); !ok {
		t.Error("open institutional records SHOULD reach the model — the gate is not a blanket ban")
	}
	// A lesson learned FROM restricted records is itself shareable: the rule
	// travels, the underlying record does not.
	if _, ok := f.Get("L-2", LLMAccess); !ok {
		t.Error("the rule should be usable even though its source records are restricted")
	}

	withheld := f.LLMWithheld()
	if len(withheld) == 0 {
		t.Fatal("expected some records to be withheld")
	}
	for _, n := range withheld {
		if n.Sensitivity == Open {
			t.Errorf("open record %s should not be withheld", n.ID)
		}
	}
}

// The model must be told that records exist but are withheld — not left to
// fill the silence with a guess.
func TestReportsWithholdingToModel(t *testing.T) {
	f := Seed()
	a := f.Recall("what do we know about EM-B's coaching?", LLMAccess)
	if a.Redactions.Count == 0 {
		t.Fatal("expected the withheld record to be reported")
	}
	if !strings.Contains(strings.ToLower(a.Redactions.Reason), "withheld") {
		t.Errorf("expected an explicit withholding note, got %q", a.Redactions.Reason)
	}
}

// Derived facts must not be dressed up as stated ones.
func TestProvenanceIsHonest(t *testing.T) {
	f := Seed()
	d, _ := f.Get("D-193", HumanAccess)
	if d.Provenance.Confidence != Stated {
		t.Error("D-193 was stated by the executive")
	}
	churn, _ := f.Get("EV-212", HumanAccess)
	if churn.Provenance.Confidence != Derived {
		t.Error("churn was derived from analytics, not stated")
	}
}

func TestStats(t *testing.T) {
	f := Seed()
	s := f.Stats()
	if s.Nodes < 10 {
		t.Errorf("expected a populated fabric, got %d nodes", s.Nodes)
	}
	if s.ByKind["decision"] == 0 || s.ByKind["lesson"] == 0 {
		t.Error("expected decisions and lessons")
	}
	if s.BySensitivity[Personal] == 0 {
		t.Error("expected personal records to exist (and be gated)")
	}
}
