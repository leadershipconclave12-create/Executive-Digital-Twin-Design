// Package study makes the twin literate in his actual files: it reads the
// documents already on the laptop and turns each into a memory-fabric node, so
// recall and meeting prep can cite "the SLA report you touched on Tuesday" the
// same way they cite a decision.
//
// Honesty rules carried over from everywhere else:
//   - a studied doc is provenance "derived" (a summary of a file, not a stated
//     fact) and its confidence says so;
//   - local personal folders default to sensitivity RESTRICTED — readable by
//     him, never placed in a prompt — until he opens them up;
//   - text formats are read natively; Office formats go through the read-only
//     COM reader; what can't be read is skipped and counted, not faked.
package study

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"eios/internal/agent"
	"eios/internal/llm"
	"eios/internal/memory"
)

// Studied is the record of one document the twin has read.
type Studied struct {
	NodeID   string `json:"nodeId"`
	Name     string `json:"name"`
	Path     string `json:"path"`
	Kind     string `json:"kind"`   // text | word | excel | powerpoint
	Method   string `json:"method"` // native | com | model
	Summary  string `json:"summary"`
	Skipped  bool   `json:"skipped"`
	SkipWhy  string `json:"skipWhy,omitempty"`
	StudiedAt string `json:"studiedAt"`
}

// Report is the outcome of one scan.
type Report struct {
	Scanned  int       `json:"scanned"`
	Studied  int       `json:"studied"`
	Skipped  int       `json:"skipped"`
	Docs     []Studied `json:"docs"`
	Note     string    `json:"note"`
	CostUsd  float64   `json:"costUsd"`
}

// Engine remembers what it has already read so re-scans are cheap.
type Engine struct {
	mu     sync.Mutex
	seq    int
	seen   map[string]string // path -> nodeID
	fabric *memory.Fabric
	llm    *llm.Provider
}

func NewEngine(f *memory.Fabric, p *llm.Provider) *Engine {
	return &Engine{seen: map[string]string{}, fabric: f, llm: p}
}

// Studied count for the presence view.
func (e *Engine) Count() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.seen)
}

var textExt = map[string]bool{".txt": true, ".md": true, ".csv": true}

// Scan studies the most recent documents. useCOM enables the Office reader
// (slow; only sensible on a machine with Office installed).
func (e *Engine) Scan(limit int, useCOM bool) Report {
	docs := agent.RecentDocs(limit)
	rep := Report{}
	for _, d := range docs {
		rep.Scanned++
		e.mu.Lock()
		_, dup := e.seen[d.Path]
		e.mu.Unlock()
		if dup {
			continue
		}
		st := e.studyOne(d, useCOM)
		rep.Docs = append(rep.Docs, st)
		if st.Skipped {
			rep.Skipped++
		} else {
			rep.Studied++
		}
	}
	rep.Note = fmt.Sprintf("%d file(s) seen, %d newly studied, %d skipped. Studied docs are RESTRICTED by default: he can read them here; they are not placed in prompts.",
		rep.Scanned, rep.Studied, rep.Skipped)
	return rep
}

func (e *Engine) studyOne(d agent.Doc, useCOM bool) Studied {
	now := time.Now().UTC().Format(time.RFC3339)
	st := Studied{Name: d.Name, Path: d.Path, StudiedAt: now}

	var text, kind, method string
	ext := strings.ToLower(d.Ext)
	switch {
	case textExt[ext]:
		raw, err := os.ReadFile(d.Path)
		if err != nil {
			st.Skipped, st.SkipWhy = true, "unreadable: "+err.Error()
			return st
		}
		text, kind, method = string(raw), "text", "native"
	case useCOM && (ext == ".docx" || ext == ".doc" || ext == ".xlsx" || ext == ".pptx"):
		od := agent.ReadOfficeDoc(d.Path)
		if !od.Available {
			st.Skipped, st.SkipWhy = true, od.Reason+": "+od.Error
			return st
		}
		kind, method = od.Kind, "com"
		switch od.Kind {
		case "word":
			text = od.Text
		case "excel":
			var b strings.Builder
			for _, sh := range od.Sheets {
				b.WriteString(sh.Name + ": ")
				for _, row := range sh.Preview {
					b.WriteString(strings.Join(row, " | ") + "\n")
				}
			}
			text = b.String()
		case "powerpoint":
			var b strings.Builder
			for _, sl := range od.Slides {
				b.WriteString(sl.Text + "\n")
			}
			text = b.String()
		}
	default:
		st.Skipped, st.SkipWhy = true, "no reader for "+ext+" here"
		return st
	}
	if len(strings.TrimSpace(text)) < 40 {
		st.Skipped, st.SkipWhy = true, "effectively empty"
		return st
	}
	if len(text) > 6000 {
		text = text[:6000]
	}

	summary := headOf(text)
	if e.llm != nil && e.llm.Configured() {
		// Summarize with the FREE small model; the document text itself stays out
		// of frontier prompts, and the stored node is Restricted regardless.
		out, _, err := e.llm.Complete(e.llm.ModelFor("summarize"), "study-doc",
			[]llm.Message{{Role: "system", Content: "Summarize this business document in 2 sentences: what it is and what it says. Nothing else."},
				{Role: "user", Content: d.Name + "\n\n" + text}}, 0.1, 160)
		if err == nil && strings.TrimSpace(out) != "" {
			summary, st.Method = strings.TrimSpace(out), "model"
		}
	}
	if st.Method == "" {
		st.Method = method
	}
	st.Kind = kind
	st.Summary = summary

	e.mu.Lock()
	e.seq++
	id := fmt.Sprintf("DOC-%d", e.seq)
	e.seen[d.Path] = id
	e.mu.Unlock()
	st.NodeID = id

	e.fabric.Add(memory.Node{
		ID: id, Kind: "fact", Title: "Document: " + d.Name, At: d.Modified,
		Summary: summary, Tags: tagsFor(d.Name),
		Provenance: memory.Provenance{Source: "local file " + d.Path, RecordedAt: now,
			RecordedBy: "study-engine", Confidence: memory.Derived},
		Sensitivity: memory.Restricted, // his files: readable here, never prompted out
		Layer:       "documents", Lifecycle: "active",
		Confidence: memory.ConfidenceDetail{Evidence: 0.7, Reasoning: 0.6, Policy: 1, Freshness: 1,
			HumanValidation: "unvalidated", Overall: 0.68, LimitedBy: "validation",
			Explanation: "Summary of a local file; the file itself is the source of truth."},
		EntityRef: d.Name,
	})
	return st
}

func headOf(text string) string {
	text = strings.TrimSpace(text)
	if i := strings.IndexByte(text, '\n'); i > 0 && i < 220 {
		return strings.TrimSpace(text[:i])
	}
	if len(text) > 220 {
		return text[:220] + "…"
	}
	return text
}

func tagsFor(name string) []string {
	var out []string
	name = strings.ToLower(strings.TrimSuffix(name, ".docx"))
	for _, w := range strings.FieldsFunc(name, func(r rune) bool {
		return r == ' ' || r == '-' || r == '_' || r == '.'
	}) {
		if len(w) > 2 {
			out = append(out, w)
		}
	}
	return out
}
