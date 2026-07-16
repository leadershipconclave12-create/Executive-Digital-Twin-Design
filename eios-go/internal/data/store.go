package data

import (
	"sync"

	"eios/internal/domain"
)

// Store is the in-memory working set the Command Center reads and mutates.
// A single RWMutex serialises all access — the Go equivalent of the prototype's
// single-writer discipline (ARCHITECTURE.md FM8), made explicit and safe.
//
// Paused implements the executive's "pause the bot while I make changes" control:
// when true, the background heartbeat/agent must not mutate state. He pauses,
// edits, resumes; the bot then re-reads current state and continues.
type Store struct {
	mu sync.RWMutex

	Executive      domain.User
	BriefingData   domain.Briefing
	Kpis           []domain.Kpi
	Channels       []domain.ChannelHealth
	Incidents      []domain.Incident
	Signals        []domain.Signal
	Decisions      []domain.DecisionItem
	Delegations    []domain.Delegation
	Agents         []domain.Agent
	KnowledgeGraph domain.KnowledgeGraph

	paused bool
}

func NewStore() *Store {
	return &Store{
		Executive:      DeputyChief(),
		BriefingData:   Briefing(),
		Kpis:           Kpis(),
		Channels:       Channels(),
		Incidents:      Incidents(),
		Signals:        Signals(),
		Decisions:      Decisions(),
		Delegations:    Delegations(),
		Agents:         Agents(),
		KnowledgeGraph: KnowledgeGraph(),
	}
}

// Read runs fn under a read lock.
func (s *Store) Read(fn func(*Store)) { s.mu.RLock(); defer s.mu.RUnlock(); fn(s) }

// Write runs fn under a write lock.
func (s *Store) Write(fn func(*Store)) { s.mu.Lock(); defer s.mu.Unlock(); fn(s) }

// --- Pause / resume (the two-writer control) --------------------------------

func (s *Store) Paused() bool { s.mu.RLock(); defer s.mu.RUnlock(); return s.paused }

func (s *Store) SetPaused(p bool) { s.mu.Lock(); defer s.mu.Unlock(); s.paused = p }
