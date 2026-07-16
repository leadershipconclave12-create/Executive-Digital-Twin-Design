// Package services holds the domain operations the API and the One-Prompt path
// both go through, so guardrails cannot be bypassed by phrasing. Ported from
// services/decisions.ts, delegations.ts, signals.ts.
package services

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"eios/internal/data"
	"eios/internal/domain"
	"eios/internal/governance"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrAlreadyResolved = errors.New("already resolved")
	ErrAuthority      = errors.New("authority")
	ErrGuardrail      = errors.New("guardrail")
	ErrInvalid        = errors.New("invalid")
)

// --- Signals ----------------------------------------------------------------

var rank = map[string]int{"urgent": 0, "critical": 1, "routine": 2, "informational": 3}

func ListSignals(s *data.Store) []domain.Signal {
	var out []domain.Signal
	s.Read(func(st *data.Store) { out = append(out, st.Signals...) })
	sort.SliceStable(out, func(i, j int) bool { return rank[out[i].Priority] < rank[out[j].Priority] })
	return out
}

func HandleSignal(s *data.Store, a *governance.AuditLog, id string, u domain.User) (domain.Signal, error) {
	var found domain.Signal
	var ok bool
	s.Write(func(st *data.Store) {
		for i := range st.Signals {
			if st.Signals[i].ID == id {
				st.Signals[i].Handled = true
				found = st.Signals[i]
				ok = true
				return
			}
		}
	})
	if !ok {
		return domain.Signal{}, fmt.Errorf("signal %s: %w", id, ErrNotFound)
	}
	a.Append(u.Name, u.Role, "signal.handled", id, "cleared: "+found.Title)
	return found, nil
}

// --- Decisions --------------------------------------------------------------

func ListDecisions(s *data.Store) []domain.DecisionItem {
	var out []domain.DecisionItem
	s.Read(func(st *data.Store) { out = append(out, st.Decisions...) })
	return out
}

func GetDecision(s *data.Store, id string) (domain.DecisionItem, bool) {
	var d domain.DecisionItem
	var ok bool
	s.Read(func(st *data.Store) {
		for _, x := range st.Decisions {
			if x.ID == id {
				d, ok = x, true
				return
			}
		}
	})
	return d, ok
}

// ResolveDecision applies the ABAC authority ceiling before approving.
func ResolveDecision(s *data.Store, a *governance.AuditLog, id, decision string, u domain.User, rationale string) (domain.DecisionItem, error) {
	if decision != "approved" && decision != "rejected" {
		decision = "approved"
	}
	var result domain.DecisionItem
	var err error
	s.Write(func(st *data.Store) {
		idx := -1
		for i := range st.Decisions {
			if st.Decisions[i].ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			err = fmt.Errorf("decision %s not found: %w", id, ErrNotFound)
			return
		}
		item := &st.Decisions[idx]
		if item.Status != "pending" {
			err = fmt.Errorf("decision %s is already %s: %w", id, item.Status, ErrAlreadyResolved)
			return
		}
		if decision == "approved" {
			if g := governance.CanUserApprove(u, *item); !g.Allowed {
				err = fmt.Errorf("%s: %w", g.Reason, ErrAuthority)
				return
			}
		}
		item.Status = decision
		item.DecidedBy = u.Name
		item.DecidedAt = time.Now().UTC().Format(time.RFC3339)
		item.Rationale = rationale
		result = *item
	})
	if err != nil {
		return domain.DecisionItem{}, err
	}
	detail := fmt.Sprintf("%s — %s", decision, result.Type)
	if result.AmountLabel != "" {
		detail += fmt.Sprintf(" (%s)", result.AmountLabel)
	}
	a.Append(u.Name, u.Role, "decision.resolved", result.ID, detail)
	return result, nil
}

type AutoExecResult struct {
	Executed bool   `json:"executed"`
	Reason   string `json:"reason"`
}

func AttemptAutoExecute(s *data.Store, a *governance.AuditLog, id string, l governance.Limits) AutoExecResult {
	item, ok := GetDecision(s, id)
	if !ok {
		return AutoExecResult{false, "not found"}
	}
	if item.Status != "pending" {
		return AutoExecResult{false, "already " + item.Status}
	}
	g := governance.EvaluateAutoExecution(item, l)
	if !g.Allowed {
		a.Append("EIOS", "system", "guardrail.blocked", item.ID, g.Reason)
		return AutoExecResult{false, g.Reason}
	}
	s.Write(func(st *data.Store) {
		for i := range st.Decisions {
			if st.Decisions[i].ID == id {
				st.Decisions[i].Status = "auto-executed"
				st.Decisions[i].DecidedBy = "EIOS (autonomous)"
				st.Decisions[i].DecidedAt = time.Now().UTC().Format(time.RFC3339)
			}
		}
	})
	a.Append("EIOS", "system", "decision.resolved", item.ID, "auto-executed — "+item.Type)
	return AutoExecResult{true, g.Reason}
}

// --- Delegations ------------------------------------------------------------

var authorityNote = map[string]string{
	"L1": "Investigate", "L2": "Recommend", "L3": "Execute (bounded)",
	"L4": "Execute (full)", "L5": "Standing delegation",
}

var validTransitions = map[string][]string{
	"Notified":    {"In Progress", "At Risk", "Escalated"},
	"In Progress": {"At Risk", "Completed", "Escalated"},
	"At Risk":     {"In Progress", "Escalated", "Completed"},
	"Escalated":   {"In Progress", "Completed"},
	"Completed":   {},
}

var delegationCounter = 43

func ListDelegations(s *data.Store) []domain.Delegation {
	var out []domain.Delegation
	s.Read(func(st *data.Store) { out = append(out, st.Delegations...) })
	return out
}

type NewDelegation struct {
	User           domain.User
	Delegate       string
	Subject        string
	AuthorityLevel string
	SpendCapInr    int64
	Priority       string
	Deadline       string
	Context        string
}

func CreateDelegation(s *data.Store, a *governance.AuditLog, in NewDelegation) (domain.Delegation, error) {
	if in.Delegate == "" || in.Subject == "" {
		return domain.Delegation{}, fmt.Errorf("delegate and subject are required: %w", ErrInvalid)
	}
	if in.AuthorityLevel == "L3" && in.SpendCapInr <= 0 {
		return domain.Delegation{}, fmt.Errorf("L3 (bounded execution) requires a positive spend cap: %w", ErrInvalid)
	}
	if in.SpendCapInr > 0 && in.SpendCapInr > in.User.FinancialAuthorityInr {
		return domain.Delegation{}, fmt.Errorf("cannot delegate a cap beyond your own authority of ₹%d: %w", in.User.FinancialAuthorityInr, ErrAuthority)
	}
	priority := in.Priority
	if priority == "" {
		priority = "Medium"
	}
	deadline := in.Deadline
	if deadline == "" {
		deadline = "EOD"
	}
	var d domain.Delegation
	s.Write(func(st *data.Store) {
		id := fmt.Sprintf("DEL-2026-07-16-00%d", delegationCounter)
		delegationCounter++
		d = domain.Delegation{
			ID: id, Delegator: in.User.Name, Delegate: in.Delegate, Subject: in.Subject,
			Context: in.Context, AuthorityLevel: in.AuthorityLevel, AuthorityNote: authorityNote[in.AuthorityLevel],
			SpendCapInr: in.SpendCapInr, Priority: priority, Deadline: deadline,
			Status: "Notified", Progress: 5, CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		st.Delegations = append([]domain.Delegation{d}, st.Delegations...)
	})
	a.Append(in.User.Name, in.User.Role, "delegation.created", d.ID,
		fmt.Sprintf("%s → %s: %s", in.AuthorityLevel, in.Delegate, in.Subject))
	return d, nil
}

func UpdateDelegation(s *data.Store, a *governance.AuditLog, id, status string, progress *int, actor domain.User) (domain.Delegation, error) {
	var d domain.Delegation
	var err error
	s.Write(func(st *data.Store) {
		idx := -1
		for i := range st.Delegations {
			if st.Delegations[i].ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			err = fmt.Errorf("delegation %s not found: %w", id, ErrNotFound)
			return
		}
		del := &st.Delegations[idx]
		if status != "" && status != del.Status {
			legal := false
			for _, t := range validTransitions[del.Status] {
				if t == status {
					legal = true
				}
			}
			if !legal {
				err = fmt.Errorf("Illegal transition %s → %s: %w", del.Status, status, ErrInvalid)
				return
			}
			del.Status = status
			if status == "Completed" {
				del.Progress = 100
			}
		}
		if progress != nil {
			p := *progress
			if p < 0 {
				p = 0
			}
			if p > 100 {
				p = 100
			}
			del.Progress = p
		}
		d = *del
	})
	if err != nil {
		return domain.Delegation{}, err
	}
	a.Append(actor.Name, actor.Role, "delegation.updated", id, fmt.Sprintf("status=%s progress=%d%%", d.Status, d.Progress))
	return d, nil
}
