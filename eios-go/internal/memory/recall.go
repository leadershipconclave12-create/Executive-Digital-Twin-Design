package memory

import "sort"

// The recall engine. Answers from STRUCTURE, not text ranking: it finds the
// records, walks their causal edges, and assembles what it can point to. It
// costs nothing, needs no model, and cannot invent an organizational fact.
//
// Its two obligations: cite everything, and admit what it does not know.

type Basis struct {
	NodeID     string     `json:"nodeId"`
	Fact       string     `json:"fact"`
	Provenance Provenance `json:"provenance"`
}
type TimelineItem struct {
	At     string `json:"at"`
	What   string `json:"what"`
	NodeID string `json:"nodeId"`
}
type LessonOut struct {
	ID   string `json:"id"`
	Rule string `json:"rule"`
	Scar string `json:"scar"`
}
type JudgmentOut struct {
	ID       string `json:"id"`
	Trigger  string `json:"trigger"`
	Judgment string `json:"judgment"`
	Because  string `json:"because"`
}
type Validity struct {
	State             string   `json:"state"` // holds | at_risk | invalid
	BrokenAssumptions []string `json:"brokenAssumptions"`
}
type Redactions struct {
	Count  int    `json:"count"`
	Reason string `json:"reason,omitempty"`
}
type LineageItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Lifecycle string `json:"lifecycle"`
}

type Answer struct {
	Question         string            `json:"question"`
	AnswerText       string            `json:"answer"`
	Basis            []Basis           `json:"basis"`
	Timeline         []TimelineItem    `json:"timeline"`
	Lessons          []LessonOut       `json:"lessons"`
	Judgments        []JudgmentOut     `json:"judgments"`
	Confidence       string            `json:"confidence"`
	ConfidenceDetail *ConfidenceDetail `json:"confidenceDetail,omitempty"`
	Validity         *Validity         `json:"validity,omitempty"`
	Lineage          []LineageItem     `json:"lineage,omitempty"`
	Gaps             []string          `json:"gaps"`
	Redactions       Redactions        `json:"redactions"`
}

// Recall answers a question against the fabric under an access context.
func (f *Fabric) Recall(question string, a Access) Answer {
	terms := words(question)
	ans := Answer{Question: question, Basis: []Basis{}, Timeline: []TimelineItem{},
		Lessons: []LessonOut{}, Judgments: []JudgmentOut{}, Gaps: []string{}}

	hits := f.Search(question, a)
	if len(hits) == 0 {
		return f.noRecord(question, a, terms)
	}

	// Anchor on the strongest hit, then pull in what it is causally connected to.
	anchor := hits[0]
	related := map[string]Node{anchor.ID: anchor}
	for _, n := range f.Trace(anchor.ID, a, 2) {
		related[n.ID] = n
	}
	// Other direct hits matter too (the question may span records).
	for i, h := range hits {
		if i < 4 {
			related[h.ID] = h
		}
	}

	for _, n := range related {
		ans.Basis = append(ans.Basis, Basis{NodeID: n.ID, Fact: n.Summary, Provenance: n.Provenance})
		if n.At != "" {
			ans.Timeline = append(ans.Timeline, TimelineItem{At: n.At, What: n.Title, NodeID: n.ID})
		}
		if n.Kind == "lesson" {
			ans.Lessons = append(ans.Lessons, LessonOut{ID: n.ID, Rule: n.Rule, Scar: n.Scar})
		}
		if n.Kind == "judgment" {
			ans.Judgments = append(ans.Judgments, JudgmentOut{ID: n.ID, Trigger: n.Trigger,
				Judgment: n.Judgment, Because: n.Because})
		}
	}
	// A decision's own alternatives are part of the record, not a separate node.
	for _, alt := range anchor.Alternatives {
		ans.Basis = append(ans.Basis, Basis{
			NodeID: anchor.ID, Fact: "Alternative: " + alt.Option + " — not taken: " + alt.Why,
			Provenance: anchor.Provenance,
		})
	}

	sort.SliceStable(ans.Basis, func(i, j int) bool { return ans.Basis[i].NodeID < ans.Basis[j].NodeID })
	sort.SliceStable(ans.Timeline, func(i, j int) bool { return ans.Timeline[i].At < ans.Timeline[j].At })

	// Lessons/judgments that apply to the question even if not causally linked.
	for _, l := range f.LessonsFor(terms, a) {
		if !hasLesson(ans.Lessons, l.ID) {
			ans.Lessons = append(ans.Lessons, LessonOut{ID: l.ID, Rule: l.Rule, Scar: l.Scar})
		}
	}
	for _, j := range f.JudgmentsFor(terms, a) {
		if !hasJudgment(ans.Judgments, j.ID) {
			ans.Judgments = append(ans.Judgments, JudgmentOut{ID: j.ID, Trigger: j.Trigger,
				Judgment: j.Judgment, Because: j.Because})
		}
	}

	ans.AnswerText = f.compose(anchor, related)
	ans.Confidence, ans.ConfidenceDetail = confidenceFor(anchor, len(ans.Basis))
	ans.Validity = validityFor(anchor)
	ans.Lineage = lineageFor(anchor, related)
	ans.Gaps = gapsFor(anchor)
	ans.Redactions = f.redactionsFor(question, a)
	return ans
}

func hasLesson(ls []LessonOut, id string) bool {
	for _, l := range ls {
		if l.ID == id {
			return true
		}
	}
	return false
}
func hasJudgment(js []JudgmentOut, id string) bool {
	for _, j := range js {
		if j.ID == id {
			return true
		}
	}
	return false
}

// noRecord is the honest path. Guessing here is the one unforgivable failure.
func (f *Fabric) noRecord(question string, a Access, terms []string) Answer {
	return Answer{
		Question: question,
		AnswerText: "I have no record of that, and I won't guess. " +
			"Ask about a recorded decision, an incident, or a lesson — for example " +
			"\"why did we reject XYZ Bank's proposal?\" or \"what happened during the Diwali outage?\".",
		Basis: []Basis{}, Timeline: []TimelineItem{}, Lessons: []LessonOut{}, Judgments: []JudgmentOut{},
		Confidence: "low",
		Gaps:       []string{"No record in the memory fabric matches this question."},
		Redactions: f.redactionsFor(question, a),
	}
}
