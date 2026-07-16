import type {
  AnyMemory, DecisionMemory, LifecycleState, MemoryKind, Validity,
} from '../memory/model.js'
import { computeConfidence } from './confidence.js'

// Knowledge ages. This module decides how.
//
// The key semantic: NOT ALL KNOWLEDGE DECAYS THE SAME WAY.
//   - An `event` never goes stale. The Diwali outage happened; that stays true forever.
//   - An engineering estimate goes stale fast. It described a world that has moved.
//   - A policy is either current or superseded — it doesn't gently decay.
// Treating all records with one TTL is how knowledge bases start lying.

const DAY = 24 * 60 * 60 * 1000

/** Days after which a record of this kind should be re-verified. null = never stales. */
const VERIFICATION_WINDOW_DAYS: Record<MemoryKind, number | null> = {
  event: null,        // it happened — history does not expire
  decision: null,     // a decision's *validity* is governed by assumptions, not by age
  lesson: 365,        // wisdom should be re-affirmed annually, not assumed eternal
  judgment: 365,      // executive judgment should be revisited
  meeting: null,      // the meeting occurred
  project: 30,        // delivery state moves fast
  person: 180,        // people context drifts
  relationship: 120,
  strategic: 90,      // roadmap/OKR/regulatory context shifts quarterly
}

export function ageOf(node: AnyMemory, now: Date): number {
  const ref = node.lastVerifiedAt ?? node.at
  return (now.getTime() - new Date(ref).getTime()) / DAY
}

/** Freshness 0-1 for the confidence model — decays over the kind's verification window. */
export function freshnessOf(node: AnyMemory, now: Date): number {
  const window = VERIFICATION_WINDOW_DAYS[node.kind]
  if (window === null) return 1 // history is always "fresh"; it is not a claim about now
  const age = ageOf(node, now)
  if (age <= 0) return 1
  return Math.max(0, Math.min(1, 1 - age / (window * 2)))
}

/**
 * Recompute a node's lifecycle state. Explicit terminal states (superseded/obsolete/
 * archived/awaiting_validation) are respected — only active⇄stale is derived.
 */
export function ageNode(node: AnyMemory, now = new Date()): LifecycleState {
  if (node.supersededBy) return 'superseded'
  if (node.lifecycle === 'obsolete' || node.lifecycle === 'archived' || node.lifecycle === 'awaiting_validation') {
    return node.lifecycle
  }
  if (node.validUntil && now.getTime() > new Date(node.validUntil).getTime()) return 'obsolete'

  const window = VERIFICATION_WINDOW_DAYS[node.kind]
  if (window !== null && ageOf(node, now) > window) return 'stale'
  return 'active'
}

/** Apply aging in place and refresh the freshness dimension of confidence. */
export function refreshNode(node: AnyMemory, now = new Date()): void {
  node.lifecycle = ageNode(node, now)
  const fresh = freshnessOf(node, now)
  if (Math.abs(fresh - node.confidence.freshness) > 0.01) {
    node.confidence = computeConfidence({ ...node.confidence, freshness: fresh })
  }
}

/**
 * Retire old knowledge explicitly rather than letting it sit alongside the new.
 * Silent coexistence of contradictory records is the core failure of naive memory.
 */
export function supersede(oldNode: AnyMemory, newNode: AnyMemory): void {
  oldNode.supersededBy = newNode.id
  oldNode.lifecycle = 'superseded'
  newNode.supersedes = oldNode.id
}

/**
 * A decision's validity is derived from its assumptions — never asserted.
 * This is what makes a decision record temporal rather than frozen.
 */
export function validityOf(d: DecisionMemory): { state: Validity; brokenAssumptions: string[] } {
  const broken = d.assumptions.filter((a) => a.status === 'broken')
  const unverified = d.assumptions.filter((a) => a.status === 'unverified')
  if (broken.length) {
    // A load-bearing belief failed. The decision isn't necessarily wrong — but it can no
    // longer be relied on without a human revisiting it.
    return { state: broken.length >= 2 ? 'invalid' : 'at_risk', brokenAssumptions: broken.map((a) => a.text) }
  }
  if (unverified.length >= 2) return { state: 'at_risk', brokenAssumptions: [] }
  return { state: 'holds', brokenAssumptions: [] }
}

/** Mark an assumption broken by a specific record — with attribution, not silently. */
export function breakAssumption(d: DecisionMemory, assumptionId: string, brokenBy: string, at = new Date().toISOString()): boolean {
  const a = d.assumptions.find((x) => x.id === assumptionId)
  if (!a || a.status === 'broken') return false
  a.status = 'broken'
  a.brokenBy = brokenBy
  a.checkedAt = at
  return true
}
