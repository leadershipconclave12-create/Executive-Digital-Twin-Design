// The Organizational Digital Twin (the new center of EIOS).
//
// The platform version waited for a prompt. The operating-system version keeps a
// LIVING MODEL of the organization that is continuously observed, understood,
// predicted, and coordinated — the executive is interrupted only when required.
//
// This file defines the twin's vocabulary. The twin is a graph of tracked entities
// grouped under Offices; each Office owns a health Domain and runs every heartbeat.

export type OfficeId =
  | 'executive-intelligence'
  | 'strategy'
  | 'delivery'
  | 'engineering'
  | 'people'
  | 'customer'
  | 'risk'
  | 'operations'

export type HealthBand = 'healthy' | 'watch' | 'strained' | 'critical'

export interface OfficeHealth {
  office: OfficeId
  name: string
  /** 0-100; higher is healthier. */
  score: number
  band: HealthBand
  headline: string
}

// --- Tracked entities (the org's moving parts) -----------------------------
export interface Project {
  id: string
  name: string
  completion: number // 0-100
  plannedCompletion: number // where it should be by now
  riskScore: number // 0-100
  deadline: string
  em: string // owning engineering manager
}

export interface EngineeringManager {
  id: string
  name: string
  team: string
  /** 0-100 communication/leadership signal quality (from comms cadence, review latency…). */
  commsQuality: number
  loadIndex: number // 0-100
}

export interface Vendor {
  id: string
  name: string
  service: string
  slaAttainment: number // 0-100
  breachesThisQuarter: number
  renewalInDays?: number
}

export interface Release {
  id: string
  name: string
  scheduledIn: string
  riskScore: number // 0-100
  readiness: number // 0-100
}

export interface Channel {
  id: string
  name: string
  successRate: number
  status: 'healthy' | 'degraded' | 'critical'
}

export interface Regulation {
  id: string
  name: string
  windowDays: number
  requiresRoadmapChange: boolean
  addressed: boolean
}

export interface CustomerMetric {
  id: string
  name: string
  value: number
  deltaPct: number // vs baseline
  unit: string
}

export interface TwinState {
  tick: number
  startedAt: string
  lastTickAt: string
  projects: Project[]
  managers: EngineeringManager[]
  vendors: Vendor[]
  releases: Release[]
  channels: Channel[]
  regulations: Regulation[]
  customer: CustomerMetric[]
}

// --- Continuous outputs produced by the Offices ----------------------------
export type Severity = 'info' | 'notice' | 'concern' | 'urgent'

/** A thing an Office noticed this heartbeat — nobody asked for it. */
export interface Observation {
  id: string
  office: OfficeId
  severity: Severity
  title: string
  detail: string
  entityId?: string
  /** materiality 0-1: how much this matters to the executive's mandate. */
  materiality: number
  /** urgency 0-1: how time-critical acting is. */
  urgency: number
}

/** A forward-looking call — the org understood ahead of time. */
export interface Prediction {
  id: string
  office: OfficeId
  title: string
  likelihood: number // 0-1
  horizon: string
  impact: string
  recommendation: string
  /**
   * Institutional precedent from the Memory Fabric that applies here. This is what
   * makes the recommendation *executive* rather than merely analytical: the org's
   * scars change the advice. Without memory, a prediction only knows today.
   */
  precedent?: {
    lessonId: string
    rule: string
    scar: string
  }[]
}

export type Disposition = 'executive' | 'delegated' | 'handled'

/** The Attention Engine's ranked output — the scarce resource is the exec's 8 hours. */
export interface AttentionItem {
  id: string
  office: OfficeId
  title: string
  why: string
  score: number
  disposition: Disposition
  recommendedAction: string
  delegateTo?: string
}

/** What the Perception Layer is actually observing right now (honesty surface). */
export interface PerceptionStatus {
  /** Real enterprise systems feeding the twin (synthetic excluded). 0 in this POC. */
  liveSources: number
  eventsApplied: number
  connectors: {
    id: string
    name: string
    observes: string
    status: 'live' | 'not-configured' | 'error'
    eventsEmitted: number
  }[]
  recentEvents: { id: string; source: string; kind: string; entityId: string; at: string }[]
}

export interface PulseSnapshot {
  tick: number
  at: string
  offices: OfficeHealth[]
  organizationHealth: number
  attention: {
    forExecutive: AttentionItem[]
    delegated: AttentionItem[]
    handledCount: number
    hoursReclaimed: number
  }
  predictions: Prediction[]
  perception: PerceptionStatus
}

export function bandFor(score: number): HealthBand {
  if (score >= 85) return 'healthy'
  if (score >= 70) return 'watch'
  if (score >= 50) return 'strained'
  return 'critical'
}
