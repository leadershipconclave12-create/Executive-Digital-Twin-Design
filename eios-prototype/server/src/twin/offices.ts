import type {
  TwinState, Observation, Prediction, OfficeHealth, OfficeId,
} from './model.js'
import { bandFor } from './model.js'
import { memory } from '../memory/seed.js'
import { OPEN_ACCESS } from '../memory/fabric.js'

/**
 * Consult the Organizational Memory Fabric for lessons that apply to this context.
 * Offices reason WITH institutional history, not just today's telemetry.
 */
function precedentFor(tags: string[]): Prediction['precedent'] {
  const lessons = memory.lessonsFor(tags, OPEN_ACCESS)
  return lessons.length
    ? lessons.map((l) => ({ lessonId: l.id, rule: l.rule, scar: l.scar }))
    : undefined
}

// The AI Offices — the org's continuously-running "departments". Each Office is
// given the whole twin every heartbeat and returns: a health score for its domain,
// the things it noticed (observations), and what it sees coming (predictions).
// Nobody prompts them. This is the "Deputy Chief's Office made of AI" idea.

export interface OfficeResult {
  health: OfficeHealth
  observations: Observation[]
  predictions: Prediction[]
}

export interface Office {
  id: OfficeId
  name: string
  run(state: TwinState): OfficeResult
}

let obsSeq = 0
const oid = () => `OBS-${++obsSeq}`
let predSeq = 0
const pid = () => `PRD-${++predSeq}`

const health = (office: OfficeId, name: string, score: number, headline: string): OfficeHealth =>
  ({ office, name, score: Math.round(score), band: bandFor(score), headline })

// --- Delivery Office --------------------------------------------------------
const deliveryOffice: Office = {
  id: 'delivery', name: 'Delivery Office',
  run(s) {
    const observations: Observation[] = []
    const predictions: Prediction[] = []
    let worst = 100
    for (const p of s.projects) {
      const behind = p.plannedCompletion - p.completion
      worst = Math.min(worst, 100 - p.riskScore)
      if (behind > 6 || p.riskScore > 55) {
        observations.push({
          id: oid(), office: 'delivery', severity: p.riskScore > 65 ? 'urgent' : 'concern',
          title: `${p.name} at ${Math.round(p.completion)}% (plan ${Math.round(p.plannedCompletion)}%)`,
          detail: `${behind.toFixed(0)} pts behind plan; risk ${Math.round(p.riskScore)}. Owner ${p.em}.`,
          entityId: p.id, materiality: 0.7, urgency: Math.min(1, p.riskScore / 80),
        })
        const precedent = precedentFor([...(p.id === 'PRJ-A' ? ['upi'] : []), 'release', 'delay', 'delivery'])
        predictions.push({
          id: pid(), office: 'delivery',
          title: `${p.name} likely to miss ${p.deadline}`,
          likelihood: Math.min(0.95, p.riskScore / 90), horizon: 'this sprint',
          impact: 'Deadline slip; dependent releases affected',
          // Memory changes the advice: Release 15 taught that late disclosure, not
          // the slip itself, caused the churn. So the recommendation leads with it.
          recommendation: precedent?.some((x) => x.lessonId === 'L-2')
            ? `Disclose the slip risk to merchants + exec committee within 48h (L-2), then rebalance capacity to ${p.em}`
            : `Rebalance capacity to ${p.em}; consider scope cut`,
          precedent,
        })
      }
    }
    return { health: health('delivery', 'Delivery Office', worst, observations[0]?.title ?? 'On track'), observations, predictions }
  },
}

// --- Engineering Office -----------------------------------------------------
const engineeringOffice: Office = {
  id: 'engineering', name: 'Engineering Office',
  run(s) {
    const observations: Observation[] = []
    const predictions: Prediction[] = []
    let score = 90
    for (const r of s.releases) {
      score = Math.min(score, r.readiness)
      if (r.riskScore > 55) {
        observations.push({
          id: oid(), office: 'engineering', severity: r.riskScore > 65 ? 'urgent' : 'concern',
          title: `${r.name} risk rising (${Math.round(r.riskScore)})`,
          detail: `Readiness ${Math.round(r.readiness)}%, ships in ${r.scheduledIn}.`,
          entityId: r.id, materiality: 0.65, urgency: Math.min(1, r.riskScore / 80),
        })
        const precedent = precedentFor(['release', 'deploy', 'go-no-go', 'payments', 'rel-18'])
        predictions.push({
          id: pid(), office: 'engineering',
          title: `${r.name} go/no-go will need your call`,
          likelihood: r.riskScore / 100, horizon: r.scheduledIn,
          impact: 'Payments core release risk',
          recommendation: precedent?.length
            ? `Pre-brief a go/no-go with quality + risk data. Precedent applies: ${precedent.map((x) => x.rule).join(' ')}`
            : 'Pre-brief a go/no-go with quality + risk data',
          precedent,
        })
      }
    }
    return { health: health('engineering', 'Engineering Office', score, observations[0]?.title ?? 'Releases healthy'), observations, predictions }
  },
}

// --- People Office ----------------------------------------------------------
const peopleOffice: Office = {
  id: 'people', name: 'People Office',
  run(s) {
    const observations: Observation[] = []
    let score = 100
    for (const m of s.managers) {
      score = Math.min(score, m.commsQuality)
      if (m.commsQuality < 68 || m.loadIndex > 85) {
        observations.push({
          id: oid(), office: 'people', severity: m.commsQuality < 60 ? 'concern' : 'notice',
          title: `${m.name}: communication quality ${Math.round(m.commsQuality)}`,
          detail: `Load index ${Math.round(m.loadIndex)}. Early signal of strain on the ${m.team} team.`,
          entityId: m.id, materiality: 0.5, urgency: 0.3,
        })
      }
    }
    return { health: health('people', 'People Office', score, observations[0]?.title ?? 'Teams stable'), observations, predictions: [] }
  },
}

// --- Customer Office --------------------------------------------------------
const customerOffice: Office = {
  id: 'customer', name: 'Customer Office',
  run(s) {
    const observations: Observation[] = []
    const predictions: Prediction[] = []
    let score = 90
    const complaints = s.customer.find((c) => c.id === 'merchant-complaints')
    if (complaints && complaints.deltaPct > 20) {
      score -= complaints.deltaPct / 2
      observations.push({
        id: oid(), office: 'customer', severity: 'concern',
        title: `Merchant complaints +${complaints.deltaPct}% (${complaints.value}/day)`,
        detail: 'Correlated with UPI degradation window.', entityId: complaints.id,
        materiality: 0.75, urgency: 0.6,
      })
      predictions.push({
        id: pid(), office: 'customer',
        title: 'Merchant churn risk if UPI not stabilised in 48h',
        likelihood: 0.55, horizon: '48 hours', impact: 'Revenue + reputation',
        recommendation: 'Tie UPI fix (INC-4521) to a merchant comms plan',
      })
    }
    return { health: health('customer', 'Customer Office', score, observations[0]?.title ?? 'Sentiment stable'), observations, predictions }
  },
}

// --- Risk Office ------------------------------------------------------------
const riskOffice: Office = {
  id: 'risk', name: 'Risk Office',
  run(s) {
    const observations: Observation[] = []
    const predictions: Prediction[] = []
    let score = 92
    for (const v of s.vendors) {
      if (v.slaAttainment < 97 || v.breachesThisQuarter >= 3) {
        score = Math.min(score, 60)
        observations.push({
          id: oid(), office: 'risk', severity: v.breachesThisQuarter >= 3 ? 'urgent' : 'concern',
          title: `${v.name} SLA declining (${v.slaAttainment.toFixed(1)}%)`,
          detail: `${v.breachesThisQuarter} breaches this quarter on ${v.service}.`,
          entityId: v.id, materiality: 0.7, urgency: 0.5,
        })
      }
      if (v.renewalInDays !== undefined && v.renewalInDays <= 30) {
        observations.push({
          id: oid(), office: 'risk', severity: v.renewalInDays <= 14 ? 'urgent' : 'notice',
          title: `${v.name} renewal in ${v.renewalInDays} days`,
          detail: `${v.service} contract decision window closing.`, entityId: v.id,
          materiality: 0.8, urgency: 1 - v.renewalInDays / 30,
        })
      }
    }
    return { health: health('risk', 'Risk Office', score, observations[0]?.title ?? 'Risk nominal'), observations, predictions }
  },
}

// --- Operations Office ------------------------------------------------------
const operationsOffice: Office = {
  id: 'operations', name: 'Operations Office',
  run(s) {
    const observations: Observation[] = []
    let score = 95
    for (const c of s.channels) {
      if (c.status !== 'healthy') {
        // Score on SEVERITY, not raw success rate: a payment channel at 84.5% is a
        // crisis, not a "watch" — the small absolute number hides a huge impact.
        score = Math.min(score, c.status === 'critical' ? 35 : 65)
        observations.push({
          id: oid(), office: 'operations', severity: c.status === 'critical' ? 'urgent' : 'concern',
          title: `${c.name} ${c.status} at ${c.successRate.toFixed(1)}%`,
          detail: 'Live channel health below tolerance.', entityId: c.id,
          materiality: c.status === 'critical' ? 1 : 0.85,
          urgency: c.status === 'critical' ? 1 : 0.7,
        })
      }
    }
    return { health: health('operations', 'Operations Office', score, observations[0]?.title ?? 'All channels healthy'), observations, predictions: [] }
  },
}

// --- Strategy Office --------------------------------------------------------
const strategyOffice: Office = {
  id: 'strategy', name: 'Strategy Office',
  run(s) {
    const observations: Observation[] = []
    const predictions: Prediction[] = []
    let score = 88
    for (const r of s.regulations) {
      if (r.requiresRoadmapChange && !r.addressed) {
        score = 70
        observations.push({
          id: oid(), office: 'strategy', severity: 'concern',
          title: `${r.name} requires a roadmap change`,
          detail: `${r.windowDays}-day window; not yet reflected in the plan.`, entityId: r.id,
          materiality: 0.7, urgency: 0.45,
        })
        predictions.push({
          id: pid(), office: 'strategy',
          title: 'Q3 roadmap will need re-sequencing for tokenisation',
          likelihood: 0.8, horizon: 'this quarter', impact: 'Roadmap + capacity',
          recommendation: 'Approve DT-010 and insert tokenisation epic ahead of PRJ-A polish',
        })
      }
    }
    return { health: health('strategy', 'Strategy Office', score, observations[0]?.title ?? 'Roadmap aligned'), observations, predictions }
  },
}

// --- Executive Intelligence Office -----------------------------------------
// The "chief of staff" office: synthesises across the others (added by the pulse
// after peers run). Here it reports its own coordination health.
const executiveIntelligenceOffice: Office = {
  id: 'executive-intelligence', name: 'Executive Intelligence Office',
  run() {
    return {
      health: health('executive-intelligence', 'Executive Intelligence Office', 90, 'Synthesising org state'),
      observations: [], predictions: [],
    }
  },
}

export const OFFICES: Office[] = [
  executiveIntelligenceOffice,
  strategyOffice,
  deliveryOffice,
  engineeringOffice,
  peopleOffice,
  customerOffice,
  riskOffice,
  operationsOffice,
]
