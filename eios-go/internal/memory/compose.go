package memory

import (
	"fmt"
	"sort"
	"strings"
)

// Composing the prose answer, and being honest about how much to trust it.

// compose turns the anchor record and its causal neighbourhood into an answer a
// busy executive can read in one pass — decision first, then why, then what it
// cost, then whether it still holds.
func (f *Fabric) compose(anchor Node, related map[string]Node) string {
	var b strings.Builder

	switch anchor.Kind {
	case "decision":
		b.WriteString(fmt.Sprintf("%s (%s): %s", anchor.ID, humanDate(anchor.At), anchor.Summary))
		if len(anchor.Rationale) > 0 {
			b.WriteString(" The reasons on record, in order: ")
			for i, r := range anchor.Rationale {
				if i > 0 {
					b.WriteString(" ")
				}
				b.WriteString(fmt.Sprintf("(%d) %s", i+1, r))
			}
		}
		if anchor.Quote != "" {
			b.WriteString(fmt.Sprintf(" Your words at the time: “%s”", anchor.Quote))
		}
		if len(anchor.Alternatives) > 0 {
			b.WriteString(" Alternatives considered and why they were not taken: ")
			var parts []string
			for _, alt := range anchor.Alternatives {
				parts = append(parts, alt.Option+" — "+alt.Why)
			}
			b.WriteString(strings.Join(parts, "; ") + ".")
		}
		// Volunteer the revisit condition unprompted — this is the part people forget.
		if anchor.RevisitCondition != "" {
			b.WriteString(" Revisit condition: " + anchor.RevisitCondition)
			if anchor.RevisitMet {
				b.WriteString(" — this has since been MET; the decision is due for review.")
			} else {
				note := anchor.RevisitNote
				if note == "" {
					note = "It has not been met."
				}
				b.WriteString(" — " + note)
			}
		}

	case "episode":
		b.WriteString(anchor.Summary)
		if chain := causalChain(f, anchor, related); chain != "" {
			b.WriteString(" What followed: " + chain)
		}

	case "lesson":
		b.WriteString(fmt.Sprintf("%s — the rule the organization now lives by: %s", anchor.ID, anchor.Rule))
		if anchor.Scar != "" {
			b.WriteString(" It was learned the hard way: " + anchor.Scar)
		}

	case "judgment":
		b.WriteString(fmt.Sprintf("Your standing judgment (%s): when %s → %s. Because: %s",
			anchor.ID, anchor.Trigger, anchor.Judgment, anchor.Because))

	default:
		b.WriteString(anchor.Summary)
	}

	// Blocking gaps are worth stating in the answer itself.
	for _, nb := range f.Neighbors(anchor.ID, "blocked_by", HumanAccess) {
		b.WriteString(" Blocking gap: " + nb.Node.Title + ".")
	}
	return b.String()
}

// causalChain reads the caused/led_to edges outward from an episode.
func causalChain(f *Fabric, anchor Node, related map[string]Node) string {
	var steps []Node
	for _, n := range related {
		if n.ID == anchor.ID || n.Kind != "episode" {
			continue
		}
		steps = append(steps, n)
	}
	if len(steps) == 0 {
		return ""
	}
	sort.SliceStable(steps, func(i, j int) bool { return steps[i].At < steps[j].At })
	var parts []string
	for _, s := range steps {
		parts = append(parts, s.Summary)
	}
	return strings.Join(parts, " → ")
}

// confidenceFor grades the answer by the weakest link in its evidence, not the
// strongest — a chain of "derived" facts is not a "stated" one.
func confidenceFor(anchor Node, basisCount int) (string, *ConfidenceDetail) {
	d := anchor.Confidence
	switch {
	case anchor.Provenance.Confidence == Stated && basisCount >= 3 && d.Overall >= 0.85:
		return "high", &d
	case basisCount >= 2 && d.Overall >= 0.7:
		return "medium", &d
	default:
		return "low", &d
	}
}

// validityFor asks whether a conclusion still stands, or rests on ground that
// has since moved.
func validityFor(anchor Node) *Validity {
	v := &Validity{State: "holds", BrokenAssumptions: []string{}}
	if anchor.Kind == "decision" && anchor.RevisitCondition != "" && anchor.RevisitMet {
		v.State = "at_risk"
		v.BrokenAssumptions = append(v.BrokenAssumptions,
			"The revisit condition has been met: "+anchor.RevisitCondition)
	}
	if anchor.Lifecycle == "superseded" || anchor.Lifecycle == "obsolete" {
		v.State = "invalid"
		v.BrokenAssumptions = append(v.BrokenAssumptions, "The record is "+anchor.Lifecycle+".")
	}
	if anchor.Provenance.Confidence == Inferred {
		v.State = "at_risk"
		v.BrokenAssumptions = append(v.BrokenAssumptions, "The anchor fact is inferred, not stated.")
	}
	return v
}

func lineageFor(anchor Node, related map[string]Node) []LineageItem {
	out := []LineageItem{{ID: anchor.ID, Title: anchor.Title, Lifecycle: anchor.Lifecycle}}
	var ids []string
	for id := range related {
		if id != anchor.ID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		n := related[id]
		out = append(out, LineageItem{ID: n.ID, Title: n.Title, Lifecycle: n.Lifecycle})
	}
	return out
}

func gapsFor(anchor Node) []string {
	gaps := []string{}
	if anchor.Kind == "decision" && anchor.RevisitCondition != "" && !anchor.RevisitMet {
		gaps = append(gaps, "The revisit condition has not been met, so the decision still stands: "+
			anchor.RevisitCondition)
	}
	if anchor.Provenance.Confidence == Derived {
		gaps = append(gaps, "The anchor fact is derived from telemetry, not stated by a person.")
	}
	return gaps
}

// redactionsFor tells a model that records EXIST but are withheld — rather than
// hiding the gap and letting it fill the silence with a guess.
func (f *Fabric) redactionsFor(question string, a Access) Redactions {
	if a.AllowPersonal && a.AllowRestricted {
		return Redactions{Count: 0}
	}
	terms := words(question)
	n := 0
	for _, node := range f.LLMWithheld() {
		if score(node, terms) > 0 {
			n++
		}
	}
	if n == 0 {
		return Redactions{Count: 0}
	}
	return Redactions{Count: n,
		Reason: fmt.Sprintf("%d record(s) relevant to this question are personal or restricted and were withheld from the model. They exist; do not speculate about their contents.", n)}
}

// humanDate renders 2026-03-14T10:30:00Z as "14 March 2026".
func humanDate(iso string) string {
	if len(iso) < 10 {
		return iso
	}
	months := []string{"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"}
	y, m, d := iso[0:4], iso[5:7], iso[8:10]
	mi := 0
	fmt.Sscanf(m, "%d", &mi)
	if mi < 1 || mi > 12 {
		return iso
	}
	di := 0
	fmt.Sscanf(d, "%d", &di)
	return fmt.Sprintf("%d %s %s", di, months[mi-1], y)
}
