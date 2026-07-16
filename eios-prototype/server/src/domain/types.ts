// EIOS domain model — shared vocabulary across Volumes 1-7.
// IDs and terminology are kept identical to the business architecture (Vol 2):
// Autonomy Tiers, Atomic Workflows (AW-xx), Decisions (DT-xxx), KPIs (KPI-xxx).

export type AutonomyTier = 'Autonomous' | 'Supervised' | 'Human-Required'
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical'

// --- Identity (Vol 7) -------------------------------------------------------
/**
 * SINGLE USER. EIOS serves one person: the Deputy Chief (Products).
 * The type is kept (rather than removed) so the audit trail records a typed actor and
 * the auth seam has something to grow into if a second executive ever appears.
 */
export type Role = 'deputy_chief'

export interface User {
  id: string
  name: string
  role: Role
  title: string
  /**
   * The executive's own approval ceiling in INR (Vol 2 §4.2). Above this it goes to the
   * Board. Distinct from — and far above — the ₹10L limit on what EIOS may do alone.
   */
  financialAuthorityInr: number
}

// --- Signals (Vol 2 §3.2.1) ------------------------------------------------
export type SignalPriority = 'informational' | 'routine' | 'critical' | 'urgent'
export type SignalSource = 'Email' | 'Teams' | 'Alert' | 'ServiceNow' | 'NPCI' | 'RBI'

export interface Signal {
  id: string
  source: SignalSource
  title: string
  summary: string
  priority: SignalPriority
  receivedAt: string
  suggestedAction: string
  agent: string
  handled: boolean
}

// --- Channels (Vol 2 §2.3 Digital Banking) ---------------------------------
export type ChannelStatus = 'healthy' | 'degraded' | 'critical'
export interface ChannelHealth {
  id: string
  name: string
  metricLabel: string
  value: string
  successRate: number
  status: ChannelStatus
  note: string
}

// --- Incidents (Vol 2 Technology Operations) -------------------------------
export type IncidentSeverity = 'P1' | 'P2' | 'P3'
export type IncidentStatus = 'Investigating' | 'Mitigating' | 'Monitoring' | 'Resolved'
export interface Incident {
  id: string
  severity: IncidentSeverity
  title: string
  service: string
  openedAt: string
  owner: string
  status: IncidentStatus
  customerImpact: string
}

// --- Decisions (Vol 2 Ch 6 taxonomy + Vol 3 decision engine) ---------------
export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'auto-executed'
export interface DecisionItem {
  id: string
  type: string
  domain: string
  tier: AutonomyTier
  risk: RiskLevel
  summary: string
  recommendation: string
  amountInr?: number
  amountLabel?: string
  /** Model confidence 0-1 (Vol 3 decision engine). */
  confidence: number
  status: DecisionStatus
  /** Humans outside EIOS whose sign-off is required (not EIOS users). */
  requiredApprovers: string[]
  decidedBy?: string
  decidedAt?: string
  rationale?: string
}

// --- Delegations (Vol 2 Ch 8 entity + lifecycle) ---------------------------
export type DelegationStatus = 'Notified' | 'In Progress' | 'At Risk' | 'Completed' | 'Escalated'
/** Authority levels L1-L5 (Vol 2 §8.1.2). */
export type AuthorityLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'
export interface Delegation {
  id: string
  delegator: string
  delegate: string
  subject: string
  context?: string
  authorityLevel: AuthorityLevel
  authorityNote: string
  /** Spend cap in INR for L3+ bounded execution. */
  spendCapInr?: number
  priority: 'Low' | 'Medium' | 'High'
  deadline: string
  status: DelegationStatus
  progress: number
  createdAt: string
}

// --- KPIs (Vol 2 Ch 7) -----------------------------------------------------
export interface Kpi {
  id: string
  name: string
  level: 'L0' | 'L1' | 'L2'
  value: string
  target: string
  trend: 'up' | 'down' | 'flat'
  good: 'up' | 'down'
}

// --- Agents (Vol 3 Ch 11 agent departments) --------------------------------
export interface Agent {
  id: string
  name: string
  charter: string
  autonomyCeiling: AutonomyTier
  ownsWorkflows: string[]
  status: 'active' | 'idle'
}

// --- Knowledge graph (Vol 3 Ch 12) -----------------------------------------
export interface KgNode {
  id: string
  type: 'Incident' | 'Vendor' | 'Decision' | 'Delegation' | 'System' | 'Regulation' | 'Person'
  label: string
}
export interface KgEdge {
  from: string
  to: string
  relation: string
}

// --- Audit (Vol 7 Ch 10 decision journal) ----------------------------------
export interface AuditEvent {
  seq: number
  timestamp: string
  actor: string
  actorRole: Role | 'system'
  action: string
  resource: string
  detail: string
  /** Tamper-evident hash chain. */
  prevHash: string
  hash: string
}
