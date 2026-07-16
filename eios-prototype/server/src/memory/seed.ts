import { MemoryFabric } from './fabric.js'
import type {
  DecisionMemory, MeetingMemory, ProjectMemory, PersonMemory, LessonMemory,
  JudgmentMemory, MemoryNode, Provenance,
} from './model.js'
import { statedFactConfidence, computeConfidence } from '../knowledge/confidence.js'

// The organization's institutional history. In production this is accreted
// continuously from Graph/DevOps/ServiceNow/minutes via the Perception Layer; here it
// is seeded to demonstrate the fabric's shape and what recall makes possible.

const p = (source: string, recordedBy: string, confidence: Provenance['confidence'], quote?: string): Provenance =>
  ({ source, recordedBy, confidence, recordedAt: '2026-07-01T00:00:00Z', quote })

// Seeded records still must be *knowledge*, not bare records: every node needs a layer,
// a lifecycle position, and computed confidence. This builder supplies historical
// defaults (institutional history is stated, validated, and — being history — fresh).
// In production these are computed at capture time by the Knowledge Evolution service.
type Seed<T extends MemoryNode> = Omit<T, 'layer' | 'lifecycle' | 'confidence'> &
  Partial<Pick<MemoryNode, 'layer' | 'lifecycle' | 'confidence'>>

function hist<T extends MemoryNode>(n: Seed<T>): T {
  // Confidence must follow the PROVENANCE, not the author's optimism. A record whose
  // provenance is `derived` (someone computed it) has not been validated by a human and
  // must not claim to be. Marking everything "validated" is how a knowledge base scores
  // itself 100/100 and then misleads an executive.
  const prov = n.provenance?.confidence ?? 'inferred'
  const confidence =
    prov === 'stated' ? statedFactConfidence()
      : prov === 'derived'
        ? computeConfidence({ evidence: 0.8, reasoning: 0.8, policy: 0.75, freshness: 0.9, humanValidation: 'unvalidated' })
        : computeConfidence({ evidence: 0.5, reasoning: 0.6, policy: 0.6, freshness: 0.8, humanValidation: 'unvalidated' })

  return {
    layer: 'organizational' as const,
    lifecycle: 'active' as const,
    confidence,
    ...n,
  } as unknown as T
}

export function seedMemory(): MemoryFabric {
  const f = new MemoryFabric()

  // ========================================================================
  // DECISION MEMORY — the XYZ Bank rejection.
  // This is the record that answers "Why did we reject XYZ Bank's proposal?"
  // ========================================================================
  const d193 = hist<DecisionMemory>({
    id: 'D-193', kind: 'decision',
    title: "Rejected XYZ Bank's co-branded card proposal",
    at: '2026-03-14', sensitivity: 'open',
    tags: ['xyz', 'xyz-bank', 'vendor', 'partnership', 'card', 'co-branded', 'proposal', 'rejection'],
    summary: 'XYZ Bank proposed a co-branded card partnership. Rejected pending NPCI clarity.',
    outcome: 'rejected',
    rationale: [
      'Merchant adoption risk — projected uptake rested on an unvalidated 40% cross-sell assumption',
      'Fraud concern — proposed KYC delegation to XYZ conflicted with our fraud controls',
      'Engineering estimate doubled — from 6 to 13 sprints after the architecture review',
      'Risk Committee approval absent — partnership risk sign-off was never obtained',
    ],
    alternatives: [
      { option: 'Approve with reduced scope (card only, no KYC delegation)', whyNot: 'XYZ declined; KYC delegation was their core commercial ask' },
      { option: 'Defer 1 quarter pending NPCI circular', whyNot: 'Chosen in substance — recorded as rejection with an explicit revisit condition' },
      { option: 'Counter-propose a white-label arrangement', whyNot: 'Engineering capacity already committed to the UPI Autoscale programme' },
    ],
    approvals: [
      { who: 'Deputy Chief', role: 'deputy_chief', given: true, note: 'Chaired the decision' },
      { who: 'CTO', role: 'cto', given: true },
      { who: 'Risk Committee', role: 'risk', given: false, note: 'Never convened on this item — the blocking gap' },
    ],
    commitments: [
      {
        who: 'Deputy Chief',
        text: "We'll revisit after NPCI publishes the new circular.",
        condition: 'NPCI publishes updated co-branding circular',
      },
      { who: 'VP – Digital Banking', text: 'Will re-run merchant adoption modelling with real pilot data before any revisit' },
    ],
    revisitWhen: 'NPCI publishes the updated co-branding circular',
    // The load-bearing beliefs underneath the decision. A decision log stops at the
    // rationale; executive memory records what the rationale RESTS ON — because when one
    // of these breaks, the decision must be revisited even though nobody was wrong.
    assumptions: [
      { id: 'A1', text: 'NPCI will publish the co-branding circular within Q2 2026', status: 'unverified' },
      { id: 'A2', text: 'Engineering capacity stays committed to UPI Autoscale through Q3', status: 'holds' },
      { id: 'A3', text: 'XYZ will not accept a structure without KYC delegation', status: 'holds' },
    ],
    provenance: p('Partnership Review Meeting M-88 minutes', 'Chief of Staff', 'stated'),
  })
  f.add(d193)

  const m88 = hist<MeetingMemory>({
    id: 'M-88', kind: 'meeting',
    title: 'Partnership Review — XYZ Bank proposal',
    at: '2026-03-14', sensitivity: 'open',
    tags: ['xyz', 'xyz-bank', 'partnership', 'meeting', 'review'],
    summary: 'Reviewed XYZ Bank co-branded card proposal. Rejected with a revisit condition.',
    attendees: ['Deputy Chief', 'CTO', 'VP – Digital Banking', 'Head of Fraud', 'XYZ Bank delegation'],
    commitments: [
      { who: 'Deputy Chief', text: 'Revisit after NPCI circular publishes', status: 'open' },
      { who: 'VP – Digital Banking', text: 'Re-run merchant adoption model with pilot data', status: 'open' },
      { who: 'Head of Fraud', text: 'Document KYC delegation red lines', status: 'done' },
    ],
    openQuestions: [
      'Does the NPCI circular actually permit delegated KYC for co-branded issuance?',
      'Would XYZ accept a white-label structure if capacity frees up in Q4?',
    ],
    decisionsMade: ['D-193'],
    provenance: p('Meeting minutes M-88', 'Chief of Staff', 'stated',
      "Deputy Chief: \"We'll revisit after NPCI publishes the new circular. I'm not signing a KYC delegation we can't audit.\""),
  })
  f.add(m88)
  f.link({ from: 'D-193', to: 'M-88', relation: 'decided_in', provenance: p('Meeting minutes M-88', 'Chief of Staff', 'stated') })

  const fraudEvidence = hist<MemoryNode>({
    id: 'EV-441', kind: 'event',
    title: 'Fraud team red-lined KYC delegation',
    at: '2026-03-11', sensitivity: 'open',
    tags: ['xyz', 'fraud', 'kyc', 'evidence'],
    summary: 'Head of Fraud documented that delegating KYC to a partner breaks our fraud-control chain of custody.',
    provenance: p('Fraud control assessment FCA-2026-03', 'Head of Fraud', 'stated'),
  })
  f.add(fraudEvidence)
  f.link({ from: 'EV-441', to: 'D-193', relation: 'evidence_for', provenance: p('FCA-2026-03', 'Head of Fraud', 'stated') })

  const estimateEvidence = hist<MemoryNode>({
    id: 'EV-442', kind: 'event',
    title: 'Engineering estimate doubled (6 → 13 sprints)',
    at: '2026-03-09', sensitivity: 'open',
    tags: ['xyz', 'estimate', 'engineering', 'evidence'],
    summary: 'Architecture review found card-vault and settlement work was not in the original estimate.',
    provenance: p('Architecture Review ADR-118', 'Principal Architect', 'stated'),
  })
  f.add(estimateEvidence)
  f.link({ from: 'EV-442', to: 'D-193', relation: 'evidence_for', provenance: p('ADR-118', 'Principal Architect', 'stated') })

  // ========================================================================
  // ORGANIZATIONAL SCAR #1 — the Diwali incident.
  // Data says "an incident happened". Memory says "never deploy on festival weekends".
  // ========================================================================
  const diwali = hist<MemoryNode>({
    id: 'EV-301', kind: 'event',
    title: 'Diwali UPI outage — switch overloaded, rollback failed',
    at: '2025-11-01', sensitivity: 'open',
    tags: ['upi', 'incident', 'festival', 'diwali', 'deploy', 'release', 'outage', 'capacity'],
    summary: 'UPI TPS doubled over the Diwali weekend. The switch overloaded; the rollback path failed because the deploy had run 18h earlier.',
    provenance: p('INC-3301 RCA', 'VP – IT Operations', 'stated'),
  })
  const diwaliImpact = hist<MemoryNode>({
    id: 'EV-302', kind: 'event',
    title: 'Customers impacted — 4.2M failed UPI transactions',
    at: '2025-11-01', sensitivity: 'open',
    tags: ['upi', 'customer', 'impact', 'diwali'],
    summary: '4.2M failed transactions over 6 hours; merchant escalations across 3 states.',
    provenance: p('INC-3301 RCA', 'VP – IT Operations', 'derived'),
  })
  const diwaliCeo = hist<MemoryNode>({
    id: 'EV-303', kind: 'event',
    title: 'CEO review of the Diwali outage',
    at: '2025-11-06', sensitivity: 'restricted',
    tags: ['ceo', 'escalation', 'diwali', 'review'],
    summary: 'CEO convened a review. Directed that change freezes over festival peaks become policy, not judgement.',
    provenance: p('CEO review note', 'Deputy Chief', 'stated',
      'CEO: "I don\'t want to hear that someone decided it was low risk. I want it to be impossible."'),
  })
  f.add(diwali); f.add(diwaliImpact); f.add(diwaliCeo)
  f.link({ from: 'EV-301', to: 'EV-302', relation: 'caused', provenance: p('INC-3301 RCA', 'VP – IT Operations', 'stated') })
  f.link({ from: 'EV-302', to: 'EV-303', relation: 'led_to', provenance: p('CEO review note', 'Deputy Chief', 'stated') })

  const l1 = hist<LessonMemory>({
    id: 'L-1', kind: 'lesson',
    title: 'No production deploys on festival weekends',
    at: '2025-11-06', sensitivity: 'open',
    tags: ['deploy', 'release', 'festival', 'change', 'upi'],
    summary: 'Festival peaks double TPS and collapse the rollback window. Change freeze is policy.',
    rule: 'Never deploy to payment production within 72h of a festival peak. Freeze is policy, not judgement.',
    scar: '4.2M failed UPI transactions, merchant escalations in 3 states, CEO review.',
    learnedFrom: ['EV-301', 'EV-302', 'EV-303'],
    triggerTags: ['deploy', 'release', 'change', 'upi', 'festival'],
    appliesWhen: 'A release or change is scheduled within 72h of a festival peak',
    active: true,
    provenance: p('CEO review note + INC-3301 RCA', 'Deputy Chief', 'derived'),
  })
  f.add(l1)
  f.link({ from: 'L-1', to: 'EV-301', relation: 'learned_from', provenance: p('INC-3301 RCA', 'Deputy Chief', 'derived') })

  // ========================================================================
  // ORGANIZATIONAL SCAR #2 — Release 15 → complaints → churn → escalation.
  // This is the chain that should change any "should we delay Release 18?" answer.
  // ========================================================================
  const rel15 = hist<MemoryNode>({
    id: 'EV-210', kind: 'event',
    title: 'Release 15 delayed 3 weeks (payments core)',
    at: '2026-01-20', sensitivity: 'open',
    tags: ['release', 'rel-15', 'delay', 'payments', 'delivery'],
    summary: 'Release 15 shipped 3 weeks late after go/no-go was called on incomplete settlement testing.',
    provenance: p('Delivery review DR-15', 'VP – Application Dev', 'stated'),
  })
  const rel15Complaints = hist<MemoryNode>({
    id: 'EV-211', kind: 'event',
    title: 'Merchant complaints spiked +48%',
    at: '2026-02-02', sensitivity: 'open',
    tags: ['customer', 'complaints', 'merchant', 'rel-15'],
    summary: 'Delayed settlement features drove a 48% complaint spike over 2 weeks.',
    provenance: p('Customer ops dashboard export', 'VP – Digital Banking', 'derived'),
  })
  const rel15Churn = hist<MemoryNode>({
    id: 'EV-212', kind: 'event',
    title: 'Merchant churn — 1,100 merchants lost',
    at: '2026-02-18', sensitivity: 'restricted',
    tags: ['customer', 'churn', 'merchant', 'revenue', 'rel-15'],
    summary: '1,100 merchants moved primary settlement to a competitor. ~₹4.1Cr annualised revenue.',
    provenance: p('Revenue impact analysis RIA-2026-02', 'CFO office', 'derived'),
  })
  const rel15Ceo = hist<MemoryNode>({
    id: 'EV-213', kind: 'event',
    title: 'CEO escalation on merchant churn',
    at: '2026-02-24', sensitivity: 'restricted',
    tags: ['ceo', 'escalation', 'churn', 'rel-15'],
    summary: 'CEO escalated; directed that payments releases never slip silently — early disclosure required.',
    provenance: p('Exec committee minutes', 'Chief of Staff', 'stated',
      'CEO: "The delay didn\'t cost us the merchants. Finding out in February did."'),
  })
  f.add(rel15); f.add(rel15Complaints); f.add(rel15Churn); f.add(rel15Ceo)
  f.link({ from: 'EV-210', to: 'EV-211', relation: 'caused', provenance: p('DR-15', 'VP – Application Dev', 'derived') })
  f.link({ from: 'EV-211', to: 'EV-212', relation: 'led_to', provenance: p('RIA-2026-02', 'CFO office', 'derived') })
  f.link({ from: 'EV-212', to: 'EV-213', relation: 'led_to', provenance: p('Exec committee minutes', 'Chief of Staff', 'stated') })

  const l2 = hist<LessonMemory>({
    id: 'L-2', kind: 'lesson',
    title: 'Disclose payments release slippage early — the silence costs more than the slip',
    at: '2026-02-24', sensitivity: 'open',
    tags: ['release', 'delay', 'payments', 'delivery', 'customer', 'rel-18'],
    summary: 'Release 15 taught that late disclosure, not the delay itself, drove merchant churn.',
    rule: 'If a payments release will slip, disclose to merchants and the exec committee within 48h of knowing — never at the go/no-go.',
    scar: '1,100 merchants churned (~₹4.1Cr annualised) and a CEO escalation.',
    learnedFrom: ['EV-210', 'EV-211', 'EV-212', 'EV-213'],
    triggerTags: ['release', 'delay', 'payments', 'rel-18', 'go-no-go'],
    appliesWhen: 'A payments release is at risk of slipping',
    active: true,
    provenance: p('Exec committee minutes + RIA-2026-02', 'Chief of Staff', 'derived'),
  })
  f.add(l2)
  f.link({ from: 'L-2', to: 'EV-210', relation: 'learned_from', provenance: p('DR-15', 'Chief of Staff', 'derived') })
  f.link({ from: 'L-2', to: 'REL-18', relation: 'constrains', provenance: p('Exec committee minutes', 'Chief of Staff', 'derived') })

  // ========================================================================
  // PROJECT MEMORY
  // ========================================================================
  const prjA = hist<ProjectMemory>({
    id: 'PM-A', kind: 'project', entityRef: 'PRJ-A',
    title: 'UPI Autoscale Programme — delivery history',
    at: '2026-04-01', sensitivity: 'open',
    tags: ['prj-a', 'upi', 'project', 'autoscale', 'delivery'],
    summary: 'Programme to autoscale the UPI switch ahead of festival peaks. Born out of the Diwali outage.',
    milestones: [
      { at: '2026-04-15', what: 'Capacity model signed off', status: 'hit' },
      { at: '2026-05-30', what: 'Switch autoscaling in staging', status: 'hit' },
      { at: '2026-07-10', what: 'Production canary', status: 'missed' },
      { at: '2026-08-05', what: 'Full production rollout', status: 'pending' },
    ],
    blockers: ['AxisPay PSP instability blocks realistic load testing', 'EM-B at 88% load index'],
    lessonsLearned: ['L-1'],
    provenance: p('Azure DevOps PRJ-A history', 'Delivery Office', 'derived'),
  })
  f.add(prjA)
  f.link({ from: 'PM-A', to: 'PRJ-A', relation: 'about', provenance: p('Azure DevOps', 'Delivery Office', 'derived') })
  f.link({ from: 'PM-A', to: 'EV-301', relation: 'learned_from', provenance: p('INC-3301 RCA', 'Delivery Office', 'derived') })

  // ========================================================================
  // PEOPLE MEMORY — governed. Purpose-limited, work-relevant only, `personal`.
  // ========================================================================
  const emB = hist<PersonMemory>({
    id: 'PE-B', kind: 'person', entityRef: 'EM-B',
    title: 'EM – UPI Platform — working context',
    at: '2026-06-01', sensitivity: 'personal',
    tags: ['em-b', 'people', 'upi', 'manager'],
    summary: 'Work-relevant context for the UPI Platform EM. Purpose-limited to delivery support.',
    workingPreferences: ['Prefers async written updates over status calls', 'Escalates late — needs explicit invitation to raise risk'],
    strengths: ['Deep UPI switch expertise', 'Strong incident command under pressure'],
    coachingHistory: [
      { at: '2026-04-10', theme: 'Delegating more of the on-call load', outcome: 'Partially adopted; load index still high' },
      { at: '2026-06-01', theme: 'Raising delivery risk earlier', outcome: 'Ongoing' },
    ],
    provenance: p('1:1 notes (restricted)', 'Deputy Chief', 'stated'),
  })
  f.add(emB)
  f.link({ from: 'PE-B', to: 'EM-B', relation: 'about', provenance: p('1:1 notes', 'Deputy Chief', 'stated') })

  // ========================================================================
  // STRATEGIC MEMORY
  // ========================================================================
  const okr = hist<MemoryNode>({
    id: 'ST-01', kind: 'strategic',
    title: 'FY26 objective — UPI availability 99.95% at festival peak',
    at: '2026-04-01', sensitivity: 'open',
    tags: ['okr', 'strategic', 'upi', 'availability', 'festival'],
    summary: 'Board-level objective set directly in response to the Diwali outage.',
    provenance: p('FY26 OKR pack', 'CTO', 'stated'),
  })
  f.add(okr)
  f.link({ from: 'ST-01', to: 'EV-301', relation: 'learned_from', provenance: p('FY26 OKR pack', 'CTO', 'derived') })

  const npci = hist<MemoryNode>({
    id: 'ST-02', kind: 'strategic',
    title: 'NPCI co-branding circular — still unpublished',
    at: '2026-07-01', sensitivity: 'open',
    tags: ['npci', 'circular', 'regulatory', 'xyz', 'co-branded', 'partnership'],
    summary: 'The NPCI co-branding circular that D-193 waits on has not published. Revisit condition unmet as of July 2026.',
    provenance: p('Regulatory tracker', 'Compliance Officer', 'stated'),
  })
  f.add(npci)
  f.link({ from: 'ST-02', to: 'D-193', relation: 'evidence_for', provenance: p('Regulatory tracker', 'Compliance Officer', 'derived') })

  // ========================================================================
  // RELATIONSHIP MEMORY
  // ========================================================================
  const relAxis = hist<MemoryNode>({
    id: 'RL-01', kind: 'relationship',
    title: 'AxisPay — recurring SLA friction',
    at: '2026-05-01', sensitivity: 'open',
    tags: ['axispay', 'vendor', 'sla', 'relationship', 'friction', 'upi'],
    summary: 'Third quarter of SLA friction with AxisPay. Credits issued twice; relationship manager changed twice.',
    provenance: p('Vendor management log', 'Vendor Manager', 'derived'),
  })
  f.add(relAxis)
  f.link({ from: 'RL-01', to: 'VEND-AXIS', relation: 'about', provenance: p('Vendor management log', 'Vendor Manager', 'derived') })

  // ========================================================================
  // EXECUTIVE MEMORY (layer: 'executive')
  //
  // The organization remembers FACTS. The executive remembers JUDGMENT.
  //   org  : "AxisPay's SLA dropped to 90.1%"
  //   exec : "don't switch vendors mid-migration — last time we moved early it failed"
  // Different layer, different decay, different governance. Modelled separately.
  // ========================================================================
  const j1 = hist<JudgmentMemory>({
    id: 'J-01', kind: 'judgment', layer: 'executive',
    title: 'Do not switch vendors mid-migration',
    at: '2025-08-20', sensitivity: 'restricted',
    tags: ['vendor', 'sla', 'migration', 'axispay', 'switch'],
    summary: "Deputy Chief's standing judgment on vendor changes during an active migration.",
    trigger: 'A vendor SLA degrades while a migration depending on them is in flight',
    judgment: 'Keep the vendor until the migration completes; extract credits, do not switch.',
    because: 'In 2025 we moved off a PSP mid-migration to punish SLA misses. The transition failed, we ran two integrations for 5 months, and the outage count doubled.',
    learnedFrom: ['EV-501'],
    heldBy: 'Deputy Chief',
    triggerTags: ['vendor', 'sla', 'migration', 'axispay'],
    timesApplied: 2,
    provenance: p('1:1 with CTO, Aug 2025', 'Deputy Chief', 'stated',
      'Deputy Chief: "Never again. We punish them with credits, not by moving mid-flight."'),
  })
  const vendorScar = hist<MemoryNode>({
    id: 'EV-501', kind: 'event',
    title: 'Mid-migration PSP switch failed (2025)',
    at: '2025-08-01', sensitivity: 'open',
    tags: ['vendor', 'migration', 'switch', 'incident', 'psp'],
    summary: 'Switching PSP during an active migration doubled outages and ran two integrations in parallel for 5 months.',
    provenance: p('Post-migration review PMR-2025-08', 'VP – IT Operations', 'stated'),
  })
  f.add(vendorScar); f.add(j1)
  f.link({ from: 'J-01', to: 'EV-501', relation: 'learned_from', provenance: p('1:1 with CTO', 'Deputy Chief', 'stated') })

  // ========================================================================
  // DECISION LINEAGE — why a recommendation exists.
  //   Roadmap 2027 → NPCI Circular → Architecture Review → Capacity Decision → Budget
  // The payoff: when the Budget Approval is superseded, everything above it is flagged
  // as resting on a foundation that moved.
  // ========================================================================
  const budget = hist<DecisionMemory>({
    id: 'D-100', kind: 'decision',
    title: 'FY26 platform budget approved (₹42Cr)',
    at: '2025-12-10', sensitivity: 'restricted',
    tags: ['budget', 'strategic', 'capacity', 'fy26'],
    summary: 'Board approved the FY26 platform budget envelope.',
    outcome: 'approved', rationale: ['Board-approved envelope for platform modernisation'],
    alternatives: [], approvals: [{ who: 'Board', role: 'board', given: true }],
    commitments: [], assumptions: [{ id: 'A1', text: 'No mid-year regulatory capex shock', status: 'unverified' }],
    amountLabel: '₹42Cr',
    provenance: p('Board minutes Dec 2025', 'CFO office', 'stated'),
  })
  const capacity = hist<DecisionMemory>({
    id: 'D-140', kind: 'decision',
    title: 'UPI switch capacity target set at 2x festival peak',
    at: '2026-01-15', sensitivity: 'open',
    tags: ['capacity', 'upi', 'architecture', 'festival'],
    summary: 'Capacity decision derived from the Diwali outage and the FY26 budget envelope.',
    outcome: 'approved', rationale: ['Diwali 2025 proved 1x peak headroom is insufficient'],
    alternatives: [{ option: '1.5x peak', whyNot: 'Insufficient margin under the observed Diwali surge' }],
    approvals: [{ who: 'CTO', role: 'cto', given: true }], commitments: [],
    assumptions: [{ id: 'A1', text: 'Festival peak grows ≤ 2x YoY', status: 'holds' }],
    provenance: p('Capacity planning CP-2026-01', 'Principal Architect', 'stated'),
  })
  const archReview = hist<MemoryNode>({
    id: 'AR-118', kind: 'strategic',
    title: 'Architecture review — autoscale approach approved',
    at: '2026-02-20', sensitivity: 'open',
    tags: ['architecture', 'autoscale', 'upi', 'review'],
    summary: 'ARB approved the autoscale design that the UPI Autoscale programme implements.',
    provenance: p('ADR-118', 'Principal Architect', 'stated'),
  })
  const roadmap = hist<MemoryNode>({
    id: 'ST-27', kind: 'strategic',
    title: 'Roadmap 2027 — payments platform plan',
    at: '2026-06-01', sensitivity: 'open',
    tags: ['roadmap', 'strategic', '2027', 'payments'],
    summary: 'The 2027 payments roadmap, built on the autoscale architecture and the NPCI regulatory position.',
    provenance: p('Roadmap pack 2027 draft', 'CTO', 'stated'),
  })
  f.add(budget); f.add(capacity); f.add(archReview); f.add(roadmap)

  const lin = p('Lineage mapping', 'Enterprise Architecture', 'derived')
  f.link({ from: 'D-140', to: 'D-100', relation: 'depends_on', provenance: lin })
  f.link({ from: 'AR-118', to: 'D-140', relation: 'depends_on', provenance: lin })
  f.link({ from: 'ST-27', to: 'AR-118', relation: 'depends_on', provenance: lin })
  f.link({ from: 'ST-27', to: 'ST-02', relation: 'depends_on', provenance: lin })
  f.link({ from: 'PM-A', to: 'AR-118', relation: 'depends_on', provenance: lin })

  return f
}

export const memory = seedMemory()
