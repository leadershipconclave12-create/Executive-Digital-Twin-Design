import type { AutonomyTier, DecisionItem, RiskLevel, User } from '../domain/types.js'
import { config } from '../config.js'

// Autonomy guardrails (Vol 7 Ch 2) — the enforceable boundary on how far EIOS may
// act without a human. These are PURE functions so they are trivially testable and
// cannot be bypassed by the API or the agents.

const RISK_ORDER: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 }

/**
 * Classify a decision into an Autonomy Tier (Vol 2 Ch 6 / Vol 3 decision engine).
 * The tier is the MOST restrictive of what risk, amount, and confidence allow.
 */
export function classifyTier(input: {
  risk: RiskLevel
  amountInr?: number
  confidence: number
}): AutonomyTier {
  const { risk, amountInr = 0, confidence } = input

  // High/Critical risk is never fully autonomous in a regulated bank.
  if (RISK_ORDER[risk] >= RISK_ORDER.High) return 'Human-Required'

  // ADR-003: any spend at/above the autonomous limit needs a human.
  if (amountInr >= config.autonomousFinancialLimitInr) {
    return risk === 'Low' && amountInr < config.autonomousFinancialLimitInr * 5
      ? 'Supervised'
      : 'Human-Required'
  }

  // Low risk + high confidence + within limit → can run autonomously.
  if (risk === 'Low' && confidence >= config.autonomousConfidenceThreshold) return 'Autonomous'

  return 'Supervised'
}

export interface GuardrailResult {
  allowed: boolean
  reason: string
  requiresHuman: boolean
}

/**
 * Decide whether an action may auto-execute. The ₹10L financial hard-limit
 * (ADR-003) is enforced here regardless of tier or confidence.
 */
export function evaluateAutoExecution(decision: Pick<DecisionItem, 'tier' | 'amountInr' | 'confidence' | 'risk'>): GuardrailResult {
  const amount = decision.amountInr ?? 0

  if (amount >= config.autonomousFinancialLimitInr) {
    return {
      allowed: false,
      requiresHuman: true,
      reason: `Spend of ₹${amount.toLocaleString('en-IN')} meets/exceeds the ₹${config.autonomousFinancialLimitInr.toLocaleString('en-IN')} autonomous hard-limit (ADR-003) — human approval required.`,
    }
  }
  if (decision.tier !== 'Autonomous') {
    return { allowed: false, requiresHuman: true, reason: `Tier "${decision.tier}" requires human oversight.` }
  }
  if (decision.confidence < config.autonomousConfidenceThreshold) {
    return {
      allowed: false,
      requiresHuman: true,
      reason: `Confidence ${(decision.confidence * 100).toFixed(0)}% below autonomous threshold ${(config.autonomousConfidenceThreshold * 100).toFixed(0)}%.`,
    }
  }
  return { allowed: true, requiresHuman: false, reason: 'Within autonomous envelope.' }
}

/**
 * ABAC check: can this user personally approve a decision of this size?
 * (Vol 2 §4.2 authority matrix / Vol 7 Ch 6.)
 */
export function canUserApprove(user: User, decision: Pick<DecisionItem, 'amountInr'>): GuardrailResult {
  const amount = decision.amountInr ?? 0
  if (amount > user.financialAuthorityInr) {
    return {
      allowed: false,
      requiresHuman: true,
      reason: `₹${amount.toLocaleString('en-IN')} exceeds ${user.role}'s authority of ₹${user.financialAuthorityInr.toLocaleString('en-IN')}.`,
    }
  }
  return { allowed: true, requiresHuman: false, reason: 'Within delegated authority.' }
}

/**
 * Who must sign off, beyond EIOS acting alone.
 *
 * With a single user these are the people the executive must involve — they are not EIOS
 * users, they are humans outside the system whose sign-off is required. Naming them keeps
 * the four-eyes obligation visible on the decision rather than living in someone's head.
 */
export function requiredApprovers(risk: RiskLevel, amountInr = 0): string[] {
  if (RISK_ORDER[risk] >= RISK_ORDER.High || amountInr >= 10_000_000) {
    return ['Deputy Chief (Products)', 'Risk / Compliance sign-off']
  }
  if (amountInr >= config.autonomousFinancialLimitInr) return ['Deputy Chief (Products)']
  return []
}
