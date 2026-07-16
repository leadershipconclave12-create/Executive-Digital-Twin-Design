package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"eios/internal/domain"
)

// AuditLog is an append-only, hash-chained decision journal. Each entry's hash
// covers the previous hash, so any tampering breaks the chain (audit.ts).
type AuditLog struct {
	mu      sync.RWMutex
	events  []domain.AuditEvent
	nowFunc func() time.Time
}

func NewAuditLog() *AuditLog {
	return &AuditLog{nowFunc: time.Now}
}

func hashEntry(prevHash string, e domain.AuditEvent) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s|%s|%s|%s|%s|%s",
		prevHash, e.Seq, e.Timestamp, e.Actor, e.ActorRole, e.Action, e.Resource, e.Detail)))
	return hex.EncodeToString(h[:])
}

// Append records an event and links it into the chain.
func (a *AuditLog) Append(actor, actorRole, action, resource, detail string) domain.AuditEvent {
	a.mu.Lock()
	defer a.mu.Unlock()
	prev := "genesis"
	if n := len(a.events); n > 0 {
		prev = a.events[n-1].Hash
	}
	e := domain.AuditEvent{
		Seq:       len(a.events) + 1,
		Timestamp: a.nowFunc().UTC().Format(time.RFC3339),
		Actor:     actor,
		ActorRole: actorRole,
		Action:    action,
		Resource:  resource,
		Detail:    detail,
		PrevHash:  prev,
	}
	e.Hash = hashEntry(prev, e)
	a.events = append(a.events, e)
	return e
}

func (a *AuditLog) Size() int { a.mu.RLock(); defer a.mu.RUnlock(); return len(a.events) }

// List returns the most recent `limit` events (newest last, as recorded).
func (a *AuditLog) List(limit int) []domain.AuditEvent {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if limit <= 0 || limit > len(a.events) {
		limit = len(a.events)
	}
	start := len(a.events) - limit
	out := make([]domain.AuditEvent, limit)
	copy(out, a.events[start:])
	return out
}

type Integrity struct {
	Valid    bool `json:"valid"`
	BrokenAt int  `json:"brokenAt,omitempty"`
}

// Verify walks the chain and confirms every link.
func (a *AuditLog) Verify() Integrity {
	a.mu.RLock()
	defer a.mu.RUnlock()
	prev := "genesis"
	for _, e := range a.events {
		if e.PrevHash != prev || hashEntry(prev, e) != e.Hash {
			return Integrity{Valid: false, BrokenAt: e.Seq}
		}
		prev = e.Hash
	}
	return Integrity{Valid: true}
}
