import { describe, it, expect } from 'vitest'
import { classifyTier, evaluateAutoExecution, canUserApprove, requiredApprovers } from '../governance/guardrails.js'
import type { User } from '../domain/types.js'

const deputy: User = { id: 'u-dc', name: 'Deputy Chief', role: 'deputy_chief', title: 'Deputy Chief (Products)', financialAuthorityInr: 50_000_000 }

describe('classifyTier', () => {
  it('makes low-risk, high-confidence, small-spend decisions autonomous', () => {
    expect(classifyTier({ risk: 'Low', amountInr: 840_000, confidence: 0.97 })).toBe('Autonomous')
  })
  it('never makes high-risk decisions autonomous', () => {
    expect(classifyTier({ risk: 'High', amountInr: 0, confidence: 0.99 })).toBe('Human-Required')
  })
  it('drops to supervised when confidence is low', () => {
    expect(classifyTier({ risk: 'Low', amountInr: 100_000, confidence: 0.5 })).toBe('Supervised')
  })
  it('requires a human at/above the ₹10L hard-limit', () => {
    expect(classifyTier({ risk: 'Low', amountInr: 12_000_000, confidence: 0.99 })).not.toBe('Autonomous')
  })
})

describe('evaluateAutoExecution — ADR-003 ₹10L hard-limit', () => {
  it('blocks autonomous execution of spend at/above ₹10L regardless of confidence', () => {
    const r = evaluateAutoExecution({ tier: 'Autonomous', amountInr: 10_000_000, confidence: 0.99, risk: 'Low' })
    expect(r.allowed).toBe(false)
    expect(r.requiresHuman).toBe(true)
    expect(r.reason).toMatch(/hard-limit/i)
  })
  it('allows a small, confident, low-risk autonomous decision', () => {
    const r = evaluateAutoExecution({ tier: 'Autonomous', amountInr: 840_000, confidence: 0.97, risk: 'Low' })
    expect(r.allowed).toBe(true)
  })
  it('blocks when tier is not autonomous', () => {
    expect(evaluateAutoExecution({ tier: 'Supervised', amountInr: 0, confidence: 0.99, risk: 'Medium' }).allowed).toBe(false)
  })
})

describe('canUserApprove — the executive still has a ceiling', () => {
  it('lets the Deputy Chief approve a ₹1.2Cr renewal (within his ₹5Cr authority)', () => {
    expect(canUserApprove(deputy, { amountInr: 12_000_000 }).allowed).toBe(true)
  })

  it('stops even the Deputy Chief above his own authority — that goes to the Board', () => {
    // Single user does not mean unlimited. ₹6Cr exceeds his ₹5Cr ceiling.
    const r = canUserApprove(deputy, { amountInr: 60_000_000 })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/exceeds/i)
  })
})

describe('requiredApprovers — humans outside EIOS who must co-sign', () => {
  it('names risk/compliance sign-off on high-risk decisions', () => {
    expect(requiredApprovers('High', 0).join(' ')).toMatch(/Risk \/ Compliance/)
  })
  it('requires no extra approver for a small low-risk decision', () => {
    expect(requiredApprovers('Low', 100_000)).toHaveLength(0)
  })
})
