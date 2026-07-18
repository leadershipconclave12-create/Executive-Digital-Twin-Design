// Package memory is the organizational memory fabric: a provenance-traced graph
// of what the organization decided, what happened, and what it learned.
//
// Two ideas carry this package:
//
//  1. STRUCTURE, NOT SEARCH. "Why did we reject XYZ Bank?" is answered by walking
//     the graph — decision → rationale → alternatives → blocking approval →
//     revisit condition — not by ranking text. It therefore needs no model, costs
//     nothing, and cannot hallucinate.
//
//  2. THE BOUNDARY IS EGRESS, NOT ROLE. There is one user; he may read all of his
//     own memory. What is gated is what may be put in a prompt bound for a model.
//     A local read cannot leak; a prompt can.
package memory

// Sensitivity decides what may leave the machine, not who may read it.
const (
	Open       = "open"       // institutional record — may go to a model
	Restricted = "restricted" // commercially/politically sensitive — never to a model
	Personal   = "personal"   // about a named individual — never to a model
)

// How a fact came to be known. "derived" and "inferred" must never be presented
// with the confidence of "stated".
const (
	Stated   = "stated"
	Derived  = "derived"
	Inferred = "inferred"
)

type Provenance struct {
	Source     string `json:"source"`
	RecordedAt string `json:"recordedAt"`
	RecordedBy string `json:"recordedBy"`
	Confidence string `json:"confidence"`
	Quote      string `json:"quote,omitempty"`
}

type ConfidenceDetail struct {
	Evidence        float64 `json:"evidence"`
	Reasoning       float64 `json:"reasoning"`
	Policy          float64 `json:"policy"`
	Freshness       float64 `json:"freshness"`
	HumanValidation string  `json:"humanValidation"`
	Overall         float64 `json:"overall"`
	LimitedBy       string  `json:"limitedBy"`
	Explanation     string  `json:"explanation"`
}

// Alternative is a road not taken — kept because "what we rejected and why" is
// usually the part that gets lost.
type Alternative struct {
	Option string `json:"option"`
	Why    string `json:"whyNot"`
}

// Node is one record. Kinds: decision | episode | lesson | judgment | person |
// project | fact.
type Node struct {
	ID          string           `json:"id"`
	Kind        string           `json:"kind"`
	Title       string           `json:"title"`
	At          string           `json:"at"`
	Summary     string           `json:"summary"`
	Tags        []string         `json:"tags"`
	Provenance  Provenance       `json:"provenance"`
	Sensitivity string           `json:"sensitivity"`
	Layer       string           `json:"layer"`
	Lifecycle   string           `json:"lifecycle"`
	Confidence  ConfidenceDetail `json:"confidence"`

	// decision
	Rationale    []string      `json:"rationale,omitempty"`
	Alternatives []Alternative `json:"alternatives,omitempty"`
	Quote        string        `json:"quote,omitempty"`
	// The condition under which a decision should be revisited, and whether it
	// has since been met. Volunteering this unprompted is the whole point.
	RevisitCondition string `json:"revisitCondition,omitempty"`
	RevisitMet       bool   `json:"revisitMet,omitempty"`
	RevisitNote      string `json:"revisitNote,omitempty"`

	// lesson
	Rule string `json:"rule,omitempty"`
	Scar string `json:"scar,omitempty"`

	// judgment (how THIS executive decides)
	Trigger  string `json:"trigger,omitempty"`
	Judgment string `json:"judgment,omitempty"`
	Because  string `json:"because,omitempty"`

	// what this record is about (for timelines)
	EntityRef string `json:"entityRef,omitempty"`
}

// Edge is a typed relation. Relations used: caused | led_to | learned_from |
// about | blocked_by | considered | supersedes | concerns.
type Edge struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Relation string `json:"relation"`
}

// Access is the egress gate.
type Access struct {
	Name            string
	AllowRestricted bool
	AllowPersonal   bool
}

// HUMAN_ACCESS: it is his memory; he reads all of it.
var HumanAccess = Access{Name: "human", AllowRestricted: true, AllowPersonal: true}

// LLM_ACCESS: what may be placed in a prompt leaving this machine.
var LLMAccess = Access{Name: "llm", AllowRestricted: false, AllowPersonal: false}

func (a Access) permits(n Node) bool {
	switch n.Sensitivity {
	case Personal:
		return a.AllowPersonal
	case Restricted:
		return a.AllowRestricted
	default:
		return true
	}
}
