// Package governance holds the enforceable boundaries: the autonomy guardrails
// (EIOS vs the executive) and the tamper-evident audit journal (now vs later).
// Ported from guardrails.ts.
package governance

import (
	"fmt"

	"eios/internal/domain"
)

var riskOrder = map[string]int{"Low": 0, "Medium": 1, "High": 2, "Critical": 3}

// Limits carries the two thresholds from config so guardrails stay pure/testable.
type Limits struct {
	AutonomousFinancialLimitInr int64
	AutonomousConfidence        float64
}

// ClassifyTier picks the most restrictive Autonomy Tier for a decision.
func ClassifyTier(risk string, amountInr int64, confidence float64, l Limits) string {
	if riskOrder[risk] >= riskOrder["High"] {
		return "Human-Required"
	}
	if amountInr >= l.AutonomousFinancialLimitInr {
		if risk == "Low" && amountInr < l.AutonomousFinancialLimitInr*5 {
			return "Supervised"
		}
		return "Human-Required"
	}
	if risk == "Low" && confidence >= l.AutonomousConfidence {
		return "Autonomous"
	}
	return "Supervised"
}

type GuardrailResult struct {
	Allowed       bool
	Reason        string
	RequiresHuman bool
}

func inr(n int64) string { return fmt.Sprintf("₹%s", groupINR(n)) }

// evaluateAutoExecution — the ₹10L hard limit and confidence threshold.
func EvaluateAutoExecution(d domain.DecisionItem, l Limits) GuardrailResult {
	amount := d.AmountInr
	if amount >= l.AutonomousFinancialLimitInr {
		return GuardrailResult{false, fmt.Sprintf("Spend of %s meets/exceeds the %s autonomous hard-limit (ADR-003) — human approval required.", inr(amount), inr(l.AutonomousFinancialLimitInr)), true}
	}
	if d.Tier != "Autonomous" {
		return GuardrailResult{false, fmt.Sprintf("Tier %q requires human oversight.", d.Tier), true}
	}
	if d.Confidence < l.AutonomousConfidence {
		return GuardrailResult{false, fmt.Sprintf("Confidence %.0f%% below autonomous threshold %.0f%%.", d.Confidence*100, l.AutonomousConfidence*100), true}
	}
	return GuardrailResult{true, "Within autonomous envelope.", false}
}

// CanUserApprove — ABAC check against the executive's own authority ceiling.
func CanUserApprove(u domain.User, d domain.DecisionItem) GuardrailResult {
	amount := d.AmountInr
	if amount > u.FinancialAuthorityInr {
		return GuardrailResult{false, fmt.Sprintf("%s exceeds %s's authority of %s.", inr(amount), u.Role, inr(u.FinancialAuthorityInr)), true}
	}
	return GuardrailResult{true, "Within delegated authority.", false}
}

// groupINR formats an integer with Indian digit grouping (12,00,000).
func groupINR(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		if neg {
			return "-" + s
		}
		return s
	}
	head := s[:len(s)-3]
	tail := s[len(s)-3:]
	var out []byte
	// group head in pairs from the right
	for len(head) > 2 {
		out = append([]byte(","+head[len(head)-2:]), out...)
		head = head[:len(head)-2]
	}
	res := head + string(out) + "," + tail
	if neg {
		return "-" + res
	}
	return res
}
