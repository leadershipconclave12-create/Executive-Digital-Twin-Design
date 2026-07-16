// Client-side mirror of the backend DTOs (server/src/domain/types.ts). Kept in
// sync manually for this prototype; in a larger build these would be generated
// from the OpenAPI contract (Vol 5 Ch 4).

export type AutonomyTier = 'Autonomous' | 'Supervised' | 'Human-Required'
/** SINGLE USER. EIOS serves one person: the Deputy Chief (Products). */
export type Role = 'deputy_chief'

export interface User {
  id: string
  name: string
  role: Role
  title: string
  financialAuthorityInr: number
}

export type SignalPriority = 'informational' | 'routine' | 'critical' | 'urgent'
export interface Signal {
  id: string
  source: string
  title: string
  summary: string
  priority: SignalPriority
  receivedAt: string
  suggestedAction: string
  agent: string
  handled: boolean
}

export type ChannelStatus = 'healthy' | 'degraded' | 'critical'
export interface ChannelHealth {
  id: string; name: string; metricLabel: string; value: string
  successRate: number; status: ChannelStatus; note: string
}

export type IncidentSeverity = 'P1' | 'P2' | 'P3'
export interface Incident {
  id: string; severity: IncidentSeverity; title: string; service: string
  openedAt: string; owner: string; status: string; customerImpact: string
}

export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'auto-executed'
export interface DecisionItem {
  id: string; type: string; domain: string; tier: AutonomyTier
  risk: string; summary: string; recommendation: string
  amountLabel?: string; confidence: number; status: DecisionStatus
  requiredApprovers: string[]; decidedBy?: string
}

export type DelegationStatus = 'Notified' | 'In Progress' | 'At Risk' | 'Completed' | 'Escalated'
export interface Delegation {
  id: string; delegate: string; subject: string; authorityLevel: string
  authorityNote: string; priority: string; deadline: string
  status: DelegationStatus; progress: number
}

export interface Kpi {
  id: string; name: string; level: string; value: string; target: string
  trend: 'up' | 'down' | 'flat'; good: 'up' | 'down'
}

export interface Agent {
  id: string; name: string; charter: string; autonomyCeiling: AutonomyTier
  ownsWorkflows: string[]; status: 'active' | 'idle'
}

export interface AuditEvent {
  seq: number; timestamp: string; actor: string; actorRole: string
  action: string; resource: string; detail: string; hash: string
}

export interface Overview {
  executive: { name: string; org: string; date: string }
  briefing: { headline: string; bullets: string[] }
  kpis: Kpi[]
  channels: ChannelHealth[]
  incidents: Incident[]
}

// --- Organizational twin / pulse (the operating-system core) ----------------
export type HealthBand = 'healthy' | 'watch' | 'strained' | 'critical'
export interface OfficeHealth {
  office: string; name: string; score: number; band: HealthBand; headline: string
}
export type Disposition = 'executive' | 'delegated' | 'handled'
export interface AttentionItem {
  id: string; office: string; title: string; why: string; score: number
  disposition: Disposition; recommendedAction: string; delegateTo?: string
}
export interface Prediction {
  id: string; office: string; title: string; likelihood: number
  horizon: string; impact: string; recommendation: string
  precedent?: { lessonId: string; rule: string; scar: string }[]
}

// --- Organizational Memory Fabric ------------------------------------------
export interface Provenance {
  source: string; recordedAt: string; recordedBy: string
  confidence: 'stated' | 'derived' | 'inferred'; quote?: string
}
export type LifecycleState = 'active' | 'awaiting_validation' | 'stale' | 'superseded' | 'obsolete' | 'archived'
export interface ConfidenceDetail {
  evidence: number; reasoning: number; policy: number; freshness: number
  humanValidation: 'validated' | 'unvalidated' | 'disputed'
  overall: number; limitedBy: string; explanation: string
}
export interface MemoryNode {
  id: string; kind: string; title: string; at: string; summary: string
  tags: string[]; provenance: Provenance; sensitivity: 'open' | 'restricted' | 'personal'
  layer: 'organizational' | 'executive'
  lifecycle: LifecycleState
  confidence: ConfidenceDetail
  rule?: string; scar?: string
}
export interface QualityReport {
  overall: number
  totals: { records: number; trustworthy: number; stale: number; unvalidated: number
    disputed: number; awaitingValidation: number; superseded: number; obsolete: number
    restingOnMovedFoundations: number }
  byKind: Record<string, { count: number; avgConfidence: number; stale: number }>
  weakestArea: string
  recommendations: string[]
}
export interface WisdomCandidate {
  id: string; proposedRule: string; pattern: string; occurrenceCount: number
  occurrences: { nodeId: string; at: string; title: string }[]
  status: 'candidate' | 'approved' | 'rejected'; scar: string; triggerTags: string[]
}
export interface RecallAnswer {
  question: string
  answer: string
  basis: { nodeId: string; fact: string; provenance: Provenance }[]
  timeline: { at: string; what: string; nodeId: string }[]
  lessons: { id: string; rule: string; scar: string }[]
  judgments: { id: string; trigger: string; judgment: string; because: string }[]
  confidence: 'high' | 'medium' | 'low'
  confidenceDetail?: ConfidenceDetail
  validity?: { state: 'holds' | 'at_risk' | 'invalid'; brokenAssumptions: string[] }
  lineage?: { id: string; title: string; lifecycle: LifecycleState }[]
  gaps: string[]
  redactions: { count: number; reason: string }
}
export interface MemoryOverview {
  stats: { nodes: number; relations: number; byKind: Record<string, number>; bySensitivity: Record<string, number> }
  visible: number
  /** Records the executive can read but that are never sent to an LLM. */
  llmWithheld: number
  llmWithheldNote: string
  nodes: MemoryNode[]
}
export interface ConnectorReport {
  id: string; name: string; observes: string
  status: 'live' | 'not-configured' | 'error'
  eventsEmitted: number
}
export interface PerceptionStatus {
  liveSources: number
  eventsApplied: number
  connectors: ConnectorReport[]
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

export interface CommandResponse {
  reply: string
  chips?: string[]
  blocked?: boolean
}

export interface CommandEntry {
  id: string
  role: 'exec' | 'eios'
  text: string
  chips?: string[]
  blocked?: boolean
  timestamp: string
}
