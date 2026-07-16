// Package twin is the organizational heartbeat: every beat it folds fresh
// observations into the store, re-derives office health / attention / predictions,
// and pushes a snapshot to any SSE subscribers. Honors the executive's pause.
package twin

import (
	"math"
	"math/rand"
	"sync"
	"time"

	"eios/internal/data"
	"eios/internal/domain"
)

// --- Pulse DTOs (match web/src/types.ts) ------------------------------------

type OfficeHealth struct {
	Office   string `json:"office"`
	Name     string `json:"name"`
	Score    int    `json:"score"`
	Band     string `json:"band"` // healthy|watch|strained|critical
	Headline string `json:"headline"`
}
type AttentionItem struct {
	ID                string `json:"id"`
	Office            string `json:"office"`
	Title             string `json:"title"`
	Why               string `json:"why"`
	Score             int    `json:"score"`
	Disposition       string `json:"disposition"` // executive|delegated|handled
	RecommendedAction string `json:"recommendedAction"`
	DelegateTo        string `json:"delegateTo,omitempty"`
}
type Precedent struct {
	LessonID string `json:"lessonId"`
	Rule     string `json:"rule"`
	Scar     string `json:"scar"`
}
type Prediction struct {
	ID             string      `json:"id"`
	Office         string      `json:"office"`
	Title          string      `json:"title"`
	Likelihood     float64     `json:"likelihood"`
	Horizon        string      `json:"horizon"`
	Impact         string      `json:"impact"`
	Recommendation string      `json:"recommendation"`
	Precedent      []Precedent `json:"precedent,omitempty"`
}
type ConnectorReport struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Observes      string `json:"observes"`
	Status        string `json:"status"` // live|not-configured|error
	EventsEmitted int    `json:"eventsEmitted"`
}
type RecentEvent struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	Kind     string `json:"kind"`
	EntityID string `json:"entityId"`
	At       string `json:"at"`
}
type PerceptionStatus struct {
	LiveSources  int               `json:"liveSources"`
	EventsApplied int              `json:"eventsApplied"`
	Connectors   []ConnectorReport `json:"connectors"`
	RecentEvents []RecentEvent     `json:"recentEvents"`
}
type Attention struct {
	ForExecutive  []AttentionItem `json:"forExecutive"`
	Delegated     []AttentionItem `json:"delegated"`
	HandledCount  int             `json:"handledCount"`
	HoursReclaimed float64        `json:"hoursReclaimed"`
}
type Snapshot struct {
	Tick               int              `json:"tick"`
	At                 string           `json:"at"`
	Offices            []OfficeHealth   `json:"offices"`
	OrganizationHealth int              `json:"organizationHealth"`
	Attention          Attention        `json:"attention"`
	Predictions        []Prediction     `json:"predictions"`
	Perception         PerceptionStatus `json:"perception"`
	Paused             bool             `json:"paused"`
}

// --- Pulse engine -----------------------------------------------------------

type Pulse struct {
	store *data.Store
	rng   *rand.Rand

	mu           sync.Mutex
	tick         int
	eventsApplied int
	connEvents   int
	recent       []RecentEvent
	subs         map[int]chan Snapshot
	nextSub      int
}

func NewPulse(store *data.Store) *Pulse {
	return &Pulse{
		store: store,
		rng:   rand.New(rand.NewSource(42)),
		subs:  map[int]chan Snapshot{},
	}
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// Beat folds one round of synthetic observations and re-derives the twin.
// When the executive has paused the bot, it advances the clock but does not
// mutate state — his edits are safe.
func (p *Pulse) Beat(broadcast bool) {
	p.mu.Lock()
	p.tick++
	if !p.store.Paused() {
		// Drift channel success rates slightly so the live graph moves, and
		// accrue synthetic events (the POC stand-in for real connectors).
		p.store.Write(func(st *data.Store) {
			for i := range st.Channels {
				c := &st.Channels[i]
				bias := 0.0
				if c.Status == "degraded" {
					bias = 0.03
				}
				c.SuccessRate = clamp(c.SuccessRate+(p.rng.Float64()-0.5)*0.2+bias, 90, 100)
			}
		})
		p.eventsApplied += 5
		p.connEvents += 5
		ev := RecentEvent{
			ID: "ev-" + time.Now().UTC().Format("150405.000"), Source: "synthetic",
			Kind: "channel.metric", EntityID: "upi", At: time.Now().UTC().Format(time.RFC3339),
		}
		p.recent = append([]RecentEvent{ev}, p.recent...)
		if len(p.recent) > 20 {
			p.recent = p.recent[:20]
		}
	}
	snap := p.snapshotLocked()
	subs := make([]chan Snapshot, 0, len(p.subs))
	if broadcast {
		for _, ch := range p.subs {
			subs = append(subs, ch)
		}
	}
	p.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- snap:
		default:
		}
	}
}

func band(score int) string {
	switch {
	case score >= 80:
		return "healthy"
	case score >= 60:
		return "watch"
	case score >= 40:
		return "strained"
	default:
		return "critical"
	}
}

func (p *Pulse) Snapshot() Snapshot {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.snapshotLocked()
}

func (p *Pulse) snapshotLocked() Snapshot {
	var channels []domain.ChannelHealth
	var incidents []domain.Incident
	var decisions []domain.DecisionItem
	var signals []domain.Signal
	var delegations []domain.Delegation
	p.store.Read(func(st *data.Store) {
		channels = append(channels, st.Channels...)
		incidents = append(incidents, st.Incidents...)
		decisions = append(decisions, st.Decisions...)
		signals = append(signals, st.Signals...)
		delegations = append(delegations, st.Delegations...)
	})

	// Office health derived from live state.
	upi := 100.0
	for _, c := range channels {
		if c.ID == "upi" {
			upi = c.SuccessRate
		}
	}
	opsScore := int(clamp(upi-6, 0, 100)) // 97.1% → ~91 minus incident drag
	if len(incidents) > 0 {
		opsScore -= 30
	}
	if opsScore < 0 {
		opsScore = 0
	}
	pendingDecisions := 0
	for _, d := range decisions {
		if d.Status == "pending" {
			pendingDecisions++
		}
	}
	deliveryScore := 71
	complianceScore := 64
	vendorScore := 58

	offices := []OfficeHealth{
		{Office: "operations", Name: "Operations Office", Score: opsScore, Band: band(opsScore), Headline: "UPI degraded — INC-4521 mitigating (AxisPay)."},
		{Office: "delivery", Name: "Delivery Office", Score: deliveryScore, Band: band(deliveryScore), Headline: "Release 18 at 71% readiness, ships in 6 days."},
		{Office: "compliance", Name: "Compliance Office", Score: complianceScore, Band: band(complianceScore), Headline: "RBI/2026-27/44 tokenisation — 90-day clock running."},
		{Office: "engineering", Name: "Engineering Office", Score: vendorScore, Band: band(vendorScore), Headline: "AxisPay 3rd SLA breach this quarter."},
	}
	orgHealth := (opsScore + deliveryScore + complianceScore + vendorScore) / 4

	// Attention: urgent/critical signals + pending decisions → executive;
	// routine → delegated; informational/handled → handled.
	var forExec, delegated []AttentionItem
	handled := 0
	for _, s := range signals {
		if s.Handled || s.Priority == "informational" {
			handled++
			continue
		}
		item := AttentionItem{
			ID: s.ID, Office: "operations", Title: s.Title, Why: s.Summary,
			RecommendedAction: s.SuggestedAction,
		}
		switch s.Priority {
		case "urgent", "critical":
			item.Score = 90
			item.Disposition = "executive"
			forExec = append(forExec, item)
		default:
			item.Score = 55
			item.Disposition = "delegated"
			item.DelegateTo = "VP – IT Operations"
			delegated = append(delegated, item)
		}
	}

	predictions := []Prediction{
		{ID: "PRED-1", Office: "delivery", Title: "Release 18 may miss its window", Likelihood: 0.42, Horizon: "6 days", Impact: "Customer-facing payments features slip",
			Recommendation: "Disclose the risk early to stakeholders rather than absorb a silent slip.",
			Precedent:      []Precedent{{LessonID: "L-2", Rule: "Disclose delivery risk early — silence compounds churn.", Scar: "Release 15 delay → complaints → churn → CEO escalation."}}},
		{ID: "PRED-2", Office: "engineering", Title: "AxisPay likely to breach SLA again", Likelihood: 0.61, Horizon: "this quarter", Impact: "UPI reliability + contractual penalty",
			Recommendation: "Approve the SLA breach notice (DT-009) now, per precedent.",
			Precedent:      []Precedent{{LessonID: "L-1", Rule: "Freeze deploys around festivals; capacity-test PSPs.", Scar: "Diwali outage — switch overloaded, 4.2M customers impacted, CEO review."}}},
	}

	conns := []ConnectorReport{
		{ID: "synthetic", Name: "Synthetic Organization (POC)", Observes: "Simulated movement — stands in for real enterprise signals", Status: "live", EventsEmitted: p.connEvents},
		{ID: "ms-graph", Name: "Microsoft Graph", Observes: "Teams activity, calendar, mail cadence", Status: "not-configured"},
		{ID: "azure-devops", Name: "Azure DevOps", Observes: "Work items, sprint burndown, pipelines", Status: "not-configured"},
		{ID: "servicenow", Name: "ServiceNow", Observes: "Incidents, changes, vendor SLA records", Status: "not-configured"},
		{ID: "azure-monitor", Name: "Azure Monitor", Observes: "Production metrics/alerts (UPI, IMPS, APIs)", Status: "not-configured"},
	}
	recent := make([]RecentEvent, len(p.recent))
	copy(recent, p.recent)

	handledCount := handled
	return Snapshot{
		Tick: p.tick, At: time.Now().UTC().Format(time.RFC3339),
		Offices: offices, OrganizationHealth: orgHealth,
		Attention: Attention{
			ForExecutive: forExec, Delegated: delegated,
			HandledCount: handledCount, HoursReclaimed: float64(handledCount) * 0.5,
		},
		Predictions: predictions,
		Perception: PerceptionStatus{
			LiveSources: 0, EventsApplied: p.eventsApplied, Connectors: conns, RecentEvents: recent,
		},
		Paused: p.store.Paused(),
	}
}

// --- SSE subscription -------------------------------------------------------

func (p *Pulse) Subscribe() (int, chan Snapshot) {
	p.mu.Lock()
	defer p.mu.Unlock()
	id := p.nextSub
	p.nextSub++
	ch := make(chan Snapshot, 4)
	p.subs[id] = ch
	return id, ch
}

func (p *Pulse) Unsubscribe(id int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if ch, ok := p.subs[id]; ok {
		close(ch)
		delete(p.subs, id)
	}
}

// Start runs the heartbeat every d until the process exits.
func (p *Pulse) Start(d time.Duration) {
	go func() {
		t := time.NewTicker(d)
		defer t.Stop()
		for range t.C {
			p.Beat(true)
		}
	}()
}
