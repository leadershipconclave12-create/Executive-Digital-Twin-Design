// EIOS seed data — the initial known state of the organization for the Command Center.
//
// NOTE ON PROVENANCE: this file (and `store.ts`) sit under `server/src/data/`, which the
// repo `.gitignore` excludes via the `data/` rule intended for the runtime event log.
// They were therefore never committed with the rest of the source. This is a faithful
// reconstruction from the consumers (routes, services, cognitive layer) and the tests,
// kept consistent with the twin seed (`twin/state.ts`): UPI 97.1% degraded, INC-4521 on
// AxisPay, Akamai CDN renewal, RBI/2026-27/44 tokenisation.
//
// The values mirror the banking scenario used across Volumes 1-7. The Store clones these
// on construction, so each `new Store()` gets its own independent, mutable copy.

import type {
  Agent, ChannelHealth, DecisionItem, Delegation, Incident, KgEdge, KgNode, Kpi, Signal,
} from '../domain/types.js'

/** Morning briefing surfaced by the "brief me" One Prompt intent and the overview API. */
export const briefing = {
  headline: 'One thing needs you before 10:00; everything else is in hand.',
  bullets: [
    'UPI success rate is 97.1% (below the 99% floor) — INC-4521 on AxisPay, VP – IT Operations mitigating, ETA 12:00.',
    'Three decisions are queued: AxisPay SLA notice (DT-009), Akamai CDN renewal (DT-007, ₹1.2Cr), RBI tokenisation plan (DT-010).',
    'Release 18 (Payments Core) ships in 6 days at 71% readiness — Delivery Office is watching it.',
  ],
}
export type Briefing = typeof briefing

// --- Channels (mirror twin/state.ts channel health) ------------------------
export const channels: ChannelHealth[] = [
  { id: 'upi', name: 'UPI', metricLabel: 'Success rate', value: '97.1%', successRate: 97.1, status: 'degraded', note: 'PSP AxisPay degradation (INC-4521). Below the 99% threshold.' },
  { id: 'imps', name: 'IMPS', metricLabel: 'Success rate', value: '99.6%', successRate: 99.6, status: 'healthy', note: 'Within tolerance.' },
  { id: 'neft', name: 'NEFT', metricLabel: 'Success rate', value: '99.8%', successRate: 99.8, status: 'healthy', note: 'Within tolerance.' },
  { id: 'rtgs', name: 'RTGS', metricLabel: 'Success rate', value: '99.9%', successRate: 99.9, status: 'healthy', note: 'Within tolerance.' },
  { id: 'mobile', name: 'Mobile Banking', metricLabel: 'Success rate', value: '99.4%', successRate: 99.4, status: 'healthy', note: 'Within tolerance.' },
]

// --- Incidents -------------------------------------------------------------
export const incidents: Incident[] = [
  {
    id: 'INC-4521', severity: 'P2', title: 'UPI latency / success-rate degradation',
    service: 'UPI Switch (AxisPay PSP)', openedAt: '2026-07-16T06:05:00Z',
    owner: 'VP – IT Operations', status: 'Mitigating',
    customerImpact: '~2.9% of UPI transactions slow or failing since 06:01 IST.',
  },
  {
    id: 'INC-4498', severity: 'P3', title: 'Intermittent push-notification delays',
    service: 'Mobile Banking', openedAt: '2026-07-15T14:20:00Z',
    owner: 'EM – Mobile', status: 'Monitoring',
    customerImpact: 'Cosmetic; no transaction impact.',
  },
]

// --- KPIs ------------------------------------------------------------------
export const kpis: Kpi[] = [
  { id: 'KPI-UPI', name: 'UPI success rate', level: 'L0', value: '97.1%', target: '≥ 99%', trend: 'down', good: 'up' },
  { id: 'KPI-NPS', name: 'Digital NPS', level: 'L1', value: '41', target: '≥ 45', trend: 'down', good: 'up' },
  { id: 'KPI-REL', name: 'Release on-time rate', level: 'L1', value: '86%', target: '≥ 90%', trend: 'flat', good: 'up' },
  { id: 'KPI-COST', name: 'Cost per digital txn', level: 'L2', value: '₹0.38', target: '≤ ₹0.40', trend: 'down', good: 'down' },
]

// --- Decisions -------------------------------------------------------------
// ORDER MATTERS for the tests: index 0 and index 3 must exist, DT-004 must be
// already-resolved. DT-007 (₹1.2Cr) is below the executive's ₹5Cr ceiling (he can
// approve) but above the ₹10L autonomous limit (EIOS may not act alone).
export const decisions: DecisionItem[] = [
  {
    id: 'DT-004', type: 'Vendor payment release', domain: 'Procurement',
    tier: 'Supervised', risk: 'Low',
    summary: 'Release Q1 milestone payment to AxisPay (₹18L) — already approved yesterday.',
    recommendation: 'Approved and disbursed.',
    amountInr: 1_800_000, amountLabel: '₹18L', confidence: 0.91,
    status: 'approved', requiredApprovers: ['Deputy Chief (Products)'],
    decidedBy: 'Deputy Chief', decidedAt: '2026-07-15T11:02:00Z',
    rationale: 'Milestone evidence verified by Finance.',
  },
  {
    id: 'DT-007', type: 'CDN contract renewal', domain: 'Infrastructure',
    tier: 'Human-Required', risk: 'Medium',
    summary: 'Renew Akamai CDN for 12 months. Current contract expires in 12 days.',
    recommendation: 'Approve — renewal terms flat YoY; no viable migration window before expiry.',
    amountInr: 12_000_000, amountLabel: '₹1.2Cr', confidence: 0.88,
    status: 'pending', requiredApprovers: ['Deputy Chief (Products)', 'Risk / Compliance sign-off'],
  },
  {
    id: 'DT-009', type: 'SLA breach notice', domain: 'Vendor management',
    tier: 'Supervised', risk: 'Medium',
    summary: 'Issue a formal SLA breach notice to AxisPay — 3rd breach this quarter (INC-4521).',
    recommendation: 'Approve — withhold ₹1.2L per the contract penalty clause.',
    amountInr: 120_000, amountLabel: '₹1.2L', confidence: 0.9,
    status: 'pending', requiredApprovers: ['Deputy Chief (Products)'],
  },
  {
    id: 'DT-010', type: 'Regulatory implementation plan', domain: 'Compliance',
    tier: 'Human-Required', risk: 'High',
    summary: 'Adopt the RBI/2026-27/44 tokenisation implementation plan — 90-day window, ~6 sprints.',
    recommendation: 'Approve the plan; Compliance Eng to own delivery against the 90-day clock.',
    confidence: 0.83,
    status: 'pending', requiredApprovers: ['Deputy Chief (Products)', 'Risk / Compliance sign-off'],
  },
]

// --- Delegations -----------------------------------------------------------
export const delegations: Delegation[] = [
  {
    id: 'DEL-2026-07-15-0041', delegator: 'Deputy Chief', delegate: 'EM – Mobile',
    subject: 'Close out INC-4498 push-notification delays', context: 'P3; cosmetic; monitor 24h',
    authorityLevel: 'L2', authorityNote: 'Recommend', priority: 'Low', deadline: 'EOD',
    status: 'In Progress', progress: 60, createdAt: '2026-07-15T15:00:00Z',
  },
  {
    id: 'DEL-2026-07-15-0042', delegator: 'Deputy Chief', delegate: 'EM – Compliance Eng',
    subject: 'Scope RBI/2026-27/44 tokenisation impact', context: 'RBI-44; 2 systems flagged',
    authorityLevel: 'L1', authorityNote: 'Investigate', priority: 'Medium', deadline: '2026-07-18',
    status: 'Notified', progress: 5, createdAt: '2026-07-15T16:30:00Z',
  },
]

// --- Signals (attention queue before real mail is triaged in) --------------
export const signals: Signal[] = [
  {
    id: 'SIG-1', source: 'Alert', title: 'UPI success rate below threshold (97.1%)',
    summary: 'AxisPay PSP degradation; INC-4521 open, VP – IT Operations mitigating.',
    priority: 'urgent', receivedAt: '2026-07-16T06:06:00Z',
    suggestedAction: 'Delegate INC-4521 to VP – IT Operations (L3, ₹5L cap).',
    agent: 'Operations Agent', handled: false,
  },
  {
    id: 'SIG-2', source: 'RBI', title: 'RBI/2026-27/44 — card tokenisation circular',
    summary: '90-day compliance window; 2 systems affected (~6 sprints).',
    priority: 'critical', receivedAt: '2026-07-16T05:40:00Z',
    suggestedAction: 'Review and approve implementation plan (DT-010).',
    agent: 'Compliance Agent', handled: false,
  },
  {
    id: 'SIG-3', source: 'ServiceNow', title: 'AxisPay — 3rd SLA breach this quarter',
    summary: 'Contractual penalty clause triggered; DT-009 queued.',
    priority: 'critical', receivedAt: '2026-07-16T06:10:00Z',
    suggestedAction: 'Approve formal SLA breach notice (DT-009).',
    agent: 'Vendor Agent', handled: false,
  },
  {
    id: 'SIG-4', source: 'Teams', title: 'Release 18 readiness at 71%',
    summary: 'Payments Core ships in 6 days; Delivery Office tracking risk 58.',
    priority: 'routine', receivedAt: '2026-07-16T04:15:00Z',
    suggestedAction: 'No action yet — checkpoint at T-3 days.',
    agent: 'Delivery Agent', handled: false,
  },
  {
    id: 'SIG-5', source: 'Email', title: 'Weekly product metrics digest',
    summary: 'NPS 41 (-3), app rating 4.3 (-2%), merchant complaints +34%.',
    priority: 'informational', receivedAt: '2026-07-16T03:00:00Z',
    suggestedAction: 'Read at your convenience.',
    agent: 'Insights Agent', handled: false,
  },
]

// --- Agents (Vol 3 Ch 11 agent departments) --------------------------------
export const agents: Agent[] = [
  { id: 'AG-OPS', name: 'Operations Agent', charter: 'Watch channel health and incidents; propose delegations.', autonomyCeiling: 'Supervised', ownsWorkflows: ['AW-01', 'AW-02'], status: 'active' },
  { id: 'AG-VENDOR', name: 'Vendor Agent', charter: 'Track SLAs, breaches and renewals; draft notices.', autonomyCeiling: 'Supervised', ownsWorkflows: ['AW-05'], status: 'active' },
  { id: 'AG-COMPLIANCE', name: 'Compliance Agent', charter: 'Monitor RBI/NPCI circulars; map to systems and sprints.', autonomyCeiling: 'Human-Required', ownsWorkflows: ['AW-08'], status: 'active' },
  { id: 'AG-DELIVERY', name: 'Delivery Agent', charter: 'Track releases and project risk against plan.', autonomyCeiling: 'Supervised', ownsWorkflows: ['AW-03'], status: 'active' },
  { id: 'AG-INSIGHTS', name: 'Insights Agent', charter: 'Summarise product metrics and customer signals.', autonomyCeiling: 'Autonomous', ownsWorkflows: ['AW-11'], status: 'idle' },
]

// --- Knowledge graph (Vol 3 Ch 12) -----------------------------------------
export const knowledgeGraph: { nodes: KgNode[]; edges: KgEdge[] } = {
  nodes: [
    { id: 'INC-4521', type: 'Incident', label: 'UPI degradation' },
    { id: 'VEND-AXIS', type: 'Vendor', label: 'AxisPay (UPI PSP)' },
    { id: 'DT-009', type: 'Decision', label: 'AxisPay SLA notice' },
    { id: 'DT-007', type: 'Decision', label: 'Akamai CDN renewal' },
    { id: 'VEND-AKAMAI', type: 'Vendor', label: 'Akamai (CDN)' },
    { id: 'SYS-UPI', type: 'System', label: 'UPI Switch' },
    { id: 'RBI-44', type: 'Regulation', label: 'RBI/2026-27/44 Tokenisation' },
    { id: 'DT-010', type: 'Decision', label: 'RBI tokenisation plan' },
    { id: 'VP-ITOPS', type: 'Person', label: 'VP – IT Operations' },
  ],
  edges: [
    { from: 'INC-4521', to: 'VEND-AXIS', relation: 'caused_by' },
    { from: 'INC-4521', to: 'SYS-UPI', relation: 'affects' },
    { from: 'DT-009', to: 'VEND-AXIS', relation: 'targets' },
    { from: 'INC-4521', to: 'VP-ITOPS', relation: 'owned_by' },
    { from: 'DT-007', to: 'VEND-AKAMAI', relation: 'renews' },
    { from: 'DT-010', to: 'RBI-44', relation: 'implements' },
  ],
}
