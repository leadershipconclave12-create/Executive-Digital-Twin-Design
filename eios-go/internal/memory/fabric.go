package memory

import (
	"sort"
	"strings"
	"sync"
)

// Fabric is the graph. Reads are access-gated at retrieval, so a caller cannot
// accidentally hand a restricted record to a model by forgetting a check.
type Fabric struct {
	mu    sync.RWMutex
	nodes map[string]Node
	order []string
	edges []Edge
}

func New() *Fabric {
	return &Fabric{nodes: map[string]Node{}}
}

func (f *Fabric) Add(n Node) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, exists := f.nodes[n.ID]; !exists {
		f.order = append(f.order, n.ID)
	}
	f.nodes[n.ID] = n
}

func (f *Fabric) Link(from, relation, to string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.edges = append(f.edges, Edge{From: from, To: to, Relation: relation})
}

// Get returns a record only if this access context may see it.
func (f *Fabric) Get(id string, a Access) (Node, bool) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	n, ok := f.nodes[id]
	if !ok || !a.permits(n) {
		return Node{}, false
	}
	return n, true
}

func (f *Fabric) All(a Access) []Node {
	f.mu.RLock()
	defer f.mu.RUnlock()
	var out []Node
	for _, id := range f.order {
		if n := f.nodes[id]; a.permits(n) {
			out = append(out, n)
		}
	}
	return out
}

func (f *Fabric) ByKind(kind string, a Access) []Node {
	var out []Node
	for _, n := range f.All(a) {
		if n.Kind == kind {
			out = append(out, n)
		}
	}
	return out
}

// LLMWithheld reports exactly what is held back from any model — so the gap can
// be stated rather than hidden.
func (f *Fabric) LLMWithheld() []Node {
	f.mu.RLock()
	defer f.mu.RUnlock()
	var out []Node
	for _, id := range f.order {
		n := f.nodes[id]
		if !LLMAccess.permits(n) {
			out = append(out, n)
		}
	}
	return out
}

// Search is only an entry point; the graph carries the answer.
func (f *Fabric) Search(q string, a Access) []Node {
	terms := words(q)
	type scored struct {
		n Node
		s int
	}
	var hits []scored
	for _, n := range f.All(a) {
		if s := score(n, terms); s > 0 {
			hits = append(hits, scored{n, s})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].s > hits[j].s })
	out := make([]Node, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.n)
	}
	return out
}

func score(n Node, terms []string) int {
	hay := strings.ToLower(strings.Join([]string{
		n.ID, n.Title, n.Summary, strings.Join(n.Tags, " "),
		n.Rule, n.Scar, n.Quote, strings.Join(n.Rationale, " "), n.EntityRef,
	}, " "))
	s := 0
	for _, t := range terms {
		if t == "" {
			continue
		}
		if strings.Contains(hay, t) {
			s += 2
		}
		if strings.EqualFold(n.ID, t) {
			s += 12 // an explicit record id is a direct hit
		}
	}
	return s
}

// Neighbors walks one hop. relation=="" means any.
func (f *Fabric) Neighbors(id, relation string, a Access) []struct {
	Node     Node   `json:"node"`
	Relation string `json:"relation"`
} {
	f.mu.RLock()
	defer f.mu.RUnlock()
	var out []struct {
		Node     Node   `json:"node"`
		Relation string `json:"relation"`
	}
	seen := map[string]bool{}
	for _, e := range f.edges {
		var otherID, rel string
		switch {
		case e.From == id:
			otherID, rel = e.To, e.Relation
		case e.To == id:
			otherID, rel = e.From, e.Relation
		default:
			continue
		}
		if relation != "" && rel != relation {
			continue
		}
		n, ok := f.nodes[otherID]
		if !ok || !a.permits(n) || seen[otherID] {
			continue
		}
		seen[otherID] = true
		out = append(out, struct {
			Node     Node   `json:"node"`
			Relation string `json:"relation"`
		}{n, rel})
	}
	return out
}

// Trace follows causal edges outward — the "what did this lead to" chain.
func (f *Fabric) Trace(id string, a Access, depth int) []Node {
	seen := map[string]bool{id: true}
	var out []Node
	frontier := []string{id}
	for d := 0; d < depth; d++ {
		var next []string
		for _, cur := range frontier {
			for _, nb := range f.Neighbors(cur, "", a) {
				if seen[nb.Node.ID] {
					continue
				}
				seen[nb.Node.ID] = true
				out = append(out, nb.Node)
				next = append(next, nb.Node.ID)
			}
		}
		frontier = next
	}
	return out
}

// Timeline returns everything about an entity, chronologically.
func (f *Fabric) Timeline(entityRef string, a Access) []Node {
	var out []Node
	for _, n := range f.All(a) {
		if n.EntityRef == entityRef || n.ID == entityRef {
			out = append(out, n)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At < out[j].At })
	return out
}

// LessonsFor surfaces rules whose trigger tags match the question.
func (f *Fabric) LessonsFor(terms []string, a Access) []Node {
	var out []Node
	for _, n := range f.ByKind("lesson", a) {
		if tagHit(n, terms) {
			out = append(out, n)
		}
	}
	return out
}

// JudgmentsFor surfaces how THIS executive has decided similar things before.
func (f *Fabric) JudgmentsFor(terms []string, a Access) []Node {
	var out []Node
	for _, n := range f.ByKind("judgment", a) {
		if tagHit(n, terms) {
			out = append(out, n)
		}
	}
	return out
}

func tagHit(n Node, terms []string) bool {
	for _, tg := range n.Tags {
		for _, t := range terms {
			if t != "" && strings.Contains(strings.ToLower(tg), t) {
				return true
			}
		}
	}
	return false
}

type Stats struct {
	Nodes         int            `json:"nodes"`
	Relations     int            `json:"relations"`
	ByKind        map[string]int `json:"byKind"`
	BySensitivity map[string]int `json:"bySensitivity"`
}

func (f *Fabric) Stats() Stats {
	f.mu.RLock()
	defer f.mu.RUnlock()
	s := Stats{Relations: len(f.edges), ByKind: map[string]int{}, BySensitivity: map[string]int{}}
	for _, id := range f.order {
		n := f.nodes[id]
		s.Nodes++
		s.ByKind[n.Kind]++
		s.BySensitivity[n.Sensitivity]++
	}
	return s
}

var stop = map[string]bool{
	"the": true, "a": true, "an": true, "we": true, "did": true, "do": true, "does": true,
	"why": true, "what": true, "when": true, "who": true, "how": true, "is": true, "was": true,
	"to": true, "of": true, "and": true, "for": true, "on": true, "in": true, "it": true,
	"our": true, "us": true, "me": true, "i": true, "s": true, "about": true, "with": true,
	"tell": true, "show": true, "happened": true, "there": true, "that": true, "this": true,
}

func words(q string) []string {
	q = strings.ToLower(q)
	var out []string
	cur := strings.Builder{}
	flush := func() {
		if cur.Len() == 0 {
			return
		}
		w := cur.String()
		cur.Reset()
		if !stop[w] && len(w) > 1 {
			out = append(out, w)
		}
	}
	for _, r := range q {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			cur.WriteRune(r)
		} else {
			flush()
		}
	}
	flush()
	return out
}
