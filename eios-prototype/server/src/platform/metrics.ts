import type { EventStore } from './eventStore.js'
import { verifyDeterminism } from './replay.js'
import type { MemoryFabric } from '../memory/fabric.js'
import { OPEN_ACCESS } from '../memory/fabric.js'
import { validityOf } from '../knowledge/lifecycle.js'
import { invalidationRisks } from '../knowledge/lineage.js'
import type { DecisionMemory } from '../memory/model.js'
import type { DecisionItem } from '../domain/types.js'
import { feedback } from './feedback.js'

// ARCHITECTURE QUALITY METRICS.
//
// "128 tests pass" is engineering hygiene, not an architecture milestone. It says the code
// compiles and behaves as written — nothing about whether EIOS is a trustworthy Executive
// Operating System.
//
// These are the measures that actually matter. Critically, a metric that CANNOT yet be
// computed is reported as `measurable: false` with the reason — never as a flattering
// default. A platform that invents its own scorecard is exactly what this system exists
// to prevent.

export interface Metric {
  id: string
  name: string
  /** Null when the inputs to compute it honestly do not exist yet. */
  value: number | null
  unit: string
  measurable: boolean
  /** Why it cannot be measured, or what the number means. */
  detail: string
  /** Sample size behind the value — a rate over 3 events is not a rate. */
  sample?: number
}

export interface Scorecard {
  at: string
  metrics: Metric[]
  measurable: number
  notMeasurable: number
  /** The honest headline. */
  summary: string
}

export interface ScorecardInputs {
  store: EventStore
  memory: MemoryFabric
  decisions: DecisionItem[]
  /** ms from an organizational event's occurrence to it landing in the twin. */
  twinFreshnessSamples: number[]
}

export function architectureScorecard(inp: ScorecardInputs): Scorecard {
  const metrics: Metric[] = [
    replayDeterminism(inp.store),
    knowledgeIntegrity(inp.memory),
    twinFreshness(inp.twinFreshnessSamples),
    executiveAttentionPrecision(),
    falseEscalationRate(),
    autonomousHandlingRate(inp.decisions),
    recommendationAcceptance(),
    missedCriticalEventRate(),
  ]

  const measurable = metrics.filter((m) => m.measurable).length
  const notMeasurable = metrics.length - measurable
  return {
    at: new Date().toISOString(),
    metrics,
    measurable,
    notMeasurable,
    summary:
      `${measurable}/${metrics.length} architecture metrics are measurable today. ` +
      (notMeasurable
        ? `${notMeasurable} require signals the platform does not yet capture — reported as unmeasurable rather than estimated.`
        : 'All inputs are captured.'),
  }
}

/** THE foundational metric: same history ⇒ same organization. If this fails, nothing else holds. */
function replayDeterminism(store: EventStore): Metric {
  if (store.count() === 0) {
    return {
      id: 'replay_determinism', name: 'Replay determinism', value: null, unit: 'boolean',
      measurable: false, detail: 'No events in the log yet — nothing to replay.',
    }
  }
  const r = verifyDeterminism(store)
  return {
    id: 'replay_determinism', name: 'Replay determinism',
    value: r.deterministic ? 1 : 0, unit: 'boolean', measurable: true,
    detail: r.detail, sample: r.eventsApplied,
  }
}

/** % of knowledge with verified provenance AND currently-valid standing. */
function knowledgeIntegrity(memory: MemoryFabric): Metric {
  const all = memory.all(OPEN_ACCESS)
  if (!all.length) {
    return { id: 'knowledge_integrity', name: 'Knowledge integrity', value: null, unit: '%', measurable: false, detail: 'Knowledge base empty.' }
  }
  const risks = new Set(invalidationRisks(memory, OPEN_ACCESS).map((r) => r.node.id))
  let sound = 0
  for (const n of all) {
    const provenanceVerified = n.provenance.confidence === 'stated' && n.confidence.humanValidation === 'validated'
    const currentlyValid = n.lifecycle === 'active'
    const restsOnMovedFoundation = risks.has(n.id)
    const decisionStillHolds = n.kind !== 'decision' || validityOf(n as DecisionMemory).state === 'holds'
    if (provenanceVerified && currentlyValid && !restsOnMovedFoundation && decisionStillHolds) sound += 1
  }
  const pct = Math.round((sound / all.length) * 100)
  return {
    id: 'knowledge_integrity', name: 'Knowledge integrity',
    value: pct, unit: '%', measurable: true, sample: all.length,
    detail: `${sound}/${all.length} records have stated+validated provenance, are active, rest on intact foundations, and (if decisions) still hold.`,
  }
}

/** Latency from an organizational event occurring to the twin reflecting it. */
function twinFreshness(samples: number[]): Metric {
  if (!samples.length) {
    return {
      id: 'twin_freshness', name: 'Twin freshness (event → twin)', value: null, unit: 'ms',
      measurable: false, detail: 'No events ingested yet in this process.',
    }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  return {
    id: 'twin_freshness', name: 'Twin freshness (event → twin)',
    value: p95, unit: 'ms', measurable: true, sample: samples.length,
    detail: `p95 latency from event timestamp to twin update across ${samples.length} events.`,
  }
}

/** Of the items EIOS surfaced to the executive, how many genuinely needed them? */
function executiveAttentionPrecision(): Metric {
  const fb = feedback.attentionFeedback()
  if (fb.length < 3) {
    return {
      id: 'attention_precision', name: 'Executive attention precision', value: null, unit: '%',
      measurable: false, sample: fb.length,
      detail: `Requires executive feedback on surfaced items; only ${fb.length} judgement(s) captured. A rate over <3 samples would be noise, not a metric.`,
    }
  }
  const needed = fb.filter((f) => f.neededExecutive).length
  return {
    id: 'attention_precision', name: 'Executive attention precision',
    value: Math.round((needed / fb.length) * 100), unit: '%', measurable: true, sample: fb.length,
    detail: `${needed}/${fb.length} surfaced items were confirmed by the executive as genuinely needing them.`,
  }
}

/** The inverse and more dangerous failure: crying wolf. */
function falseEscalationRate(): Metric {
  const fb = feedback.attentionFeedback()
  if (fb.length < 3) {
    return {
      id: 'false_escalation', name: 'False escalation rate', value: null, unit: '%',
      measurable: false, sample: fb.length,
      detail: `Requires executive feedback; only ${fb.length} judgement(s) captured.`,
    }
  }
  const wrong = fb.filter((f) => !f.neededExecutive).length
  return {
    id: 'false_escalation', name: 'False escalation rate',
    value: Math.round((wrong / fb.length) * 100), unit: '%', measurable: true, sample: fb.length,
    detail: `${wrong}/${fb.length} surfaced items did not warrant executive attention.`,
  }
}

/** Routine work completed inside delegated authority without reaching the executive. */
function autonomousHandlingRate(decisions: DecisionItem[]): Metric {
  if (!decisions.length) {
    return { id: 'autonomous_handling', name: 'Autonomous handling rate', value: null, unit: '%', measurable: false, detail: 'No decisions recorded.' }
  }
  const auto = decisions.filter((d) => d.status === 'auto-executed').length
  return {
    id: 'autonomous_handling', name: 'Autonomous handling rate',
    value: Math.round((auto / decisions.length) * 100), unit: '%', measurable: true, sample: decisions.length,
    detail: `${auto}/${decisions.length} decisions completed within delegated authority (Tier 1, under the ₹10L hard-limit).`,
  }
}

/** Accepted / modified / rejected — the truest signal of whether advice is any good. */
function recommendationAcceptance(): Metric {
  const fb = feedback.recommendationFeedback()
  if (fb.length < 3) {
    return {
      id: 'recommendation_acceptance', name: 'Recommendation acceptance rate', value: null, unit: '%',
      measurable: false, sample: fb.length,
      detail: `Requires the executive to record accept/modify/reject against EIOS recommendations; ${fb.length} captured. Not yet wired into the approval flow.`,
    }
  }
  const accepted = fb.filter((f) => f.outcome === 'accepted').length
  return {
    id: 'recommendation_acceptance', name: 'Recommendation acceptance rate',
    value: Math.round((accepted / fb.length) * 100), unit: '%', measurable: true, sample: fb.length,
    detail: `${accepted}/${fb.length} recommendations accepted unmodified.`,
  }
}

/**
 * The metric that matters most and is hardest to get: what did EIOS MISS?
 * It cannot be computed from EIOS's own data — by definition a missed event is one the
 * system never saw. It requires post-incident review comparing reality to what was
 * surfaced. Reporting a number here would be dishonest.
 */
function missedCriticalEventRate(): Metric {
  return {
    id: 'missed_critical', name: 'Missed critical event rate', value: null, unit: '%',
    measurable: false,
    detail:
      'NOT self-measurable by design: a missed event is one EIOS never saw, so its own data cannot reveal it. ' +
      'Requires post-incident review reconciling real incidents against what was surfaced (Vol 2 KPI-008).',
  }
}
