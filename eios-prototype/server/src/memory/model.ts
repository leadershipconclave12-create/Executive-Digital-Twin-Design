// The Organizational Memory Fabric — the heart of EIOS.
//
// DESIGN COMMITMENT: this is NOT a pile of vector embeddings. The source of truth is a
// STRUCTURED GRAPH — entities, relations, timelines, and provenance. Lexical search
// (fabric.search) exists only as a retrieval AID to find an entry point into the graph;
// it never produces an answer.
//
// EXECUTIVE KNOWLEDGE PLATFORM v1 — knowledge is not a pile of records. It is a LIVING
// system: every node has a lifecycle, ages, can be superseded, rests on assumptions that
// can break, and carries confidence that is explained rather than asserted.

export type MemoryKind =
  | 'decision'      // Decision Memory — rationale, alternatives, assumptions, outcome
  | 'meeting'       // Meeting Memory — commitments, open questions, actions
  | 'project'       // Project Memory — timeline, blockers, delivery history
  | 'person'        // People Memory — preferences, coaching (GOVERNED, see sensitivity)
  | 'relationship'  // Relationship Memory — dependencies, friction, collaboration
  | 'strategic'     // Strategic Memory — OKRs, roadmap, regulatory context
  | 'event'         // Institutional episodes — incidents, escalations, outcomes
  | 'lesson'        // Organizational wisdom / scar tissue (human-approved)
  | 'judgment'      // EXECUTIVE memory — this executive's judgment, not the org's facts

/**
 * Organizational memory ≠ Executive memory.
 *
 *   organizational : what the ORG knows      — "AxisPay's SLA dropped to 90.1%"
 *   executive      : what the EXEC judges    — "don't switch vendors mid-migration;
 *                                              last time we moved early the transition failed"
 *
 * Facts and judgment decay differently, are governed differently, and answer different
 * questions. Collapsing them into one store is how a knowledge base becomes untrustworthy.
 */
export type MemoryLayer = 'organizational' | 'executive'

/**
 * Knowledge is temporal. A record is not "true forever" — it holds a position in a
 * lifecycle and moves through it as the world changes.
 */
export type LifecycleState =
  | 'active'              // current and trusted
  | 'awaiting_validation' // proposed (e.g. candidate wisdom) — not yet authoritative
  | 'stale'               // aged past its verification window; still usable, flagged
  | 'superseded'          // replaced by a newer record (see supersededBy)
  | 'obsolete'            // no longer applicable at all
  | 'archived'            // retained for audit only

/**
 * Confidence is multidimensional. "0.92" tells an executive nothing actionable;
 * "0.62, limited by freshness — the estimate is 4 months old" tells them what to fix.
 */
export interface Confidence {
  /** Quality of the underlying evidence. */
  evidence: number
  /** Soundness of the inference drawn from it. */
  reasoning: number
  /** Policy/compliance validation. */
  policy: number
  /** How current the underlying data is. */
  freshness: number
  humanValidation: 'validated' | 'unvalidated' | 'disputed'
  /** Derived — never set by hand. */
  overall: number
  /** Which dimension is holding `overall` down. The actionable part. */
  limitedBy: string
  explanation: string
}

/**
 * Decisions rest on assumptions. When an assumption breaks, the decision does not
 * automatically become wrong — but its VALIDITY changes, and the executive must be told.
 * This is the difference between a decision log and executive memory.
 */
export interface Assumption {
  id: string
  text: string
  status: 'holds' | 'broken' | 'unverified'
  /** Node id of the record that broke it. */
  brokenBy?: string
  checkedAt?: string
}

/** Derived from assumption health — never stored by hand. */
export type Validity = 'holds' | 'at_risk' | 'invalid'

export interface Provenance {
  source: string
  recordedAt: string
  recordedBy: string
  /** stated = someone said/wrote it · derived = computed from records · inferred = model guess */
  confidence: 'stated' | 'derived' | 'inferred'
  quote?: string
}

export type Sensitivity = 'open' | 'restricted' | 'personal'

export interface MemoryNode {
  id: string
  kind: MemoryKind
  layer: MemoryLayer
  title: string
  /** When it HAPPENED (timeline position) — distinct from when it was recorded. */
  at: string
  summary: string
  tags: string[]
  provenance: Provenance
  sensitivity: Sensitivity

  // --- temporal / lifecycle semantics ---
  lifecycle: LifecycleState
  confidence: Confidence
  /** Explicit expiry, where the record type has one (estimates, ratings, policies). */
  validUntil?: string
  /** Last time a human or system re-verified this. Drives staleness. */
  lastVerifiedAt?: string
  supersededBy?: string
  supersedes?: string
}

export interface DecisionMemory extends MemoryNode {
  kind: 'decision'
  outcome: 'approved' | 'rejected' | 'deferred'
  rationale: string[]
  alternatives: { option: string; whyNot: string }[]
  approvals: { who: string; role: string; given: boolean; note?: string }[]
  commitments: { who: string; text: string; condition?: string }[]
  /** The load-bearing beliefs. When one breaks, validity degrades. */
  assumptions: Assumption[]
  revisitWhen?: string
  amountLabel?: string
  reopenedAt?: string
  /** What actually happened vs what we expected — the input to learning. */
  realized?: { at: string; expected: string; actual: string; delta: string }
}

export interface MeetingMemory extends MemoryNode {
  kind: 'meeting'
  attendees: string[]
  commitments: { who: string; text: string; status: 'open' | 'done' | 'slipped' }[]
  openQuestions: string[]
  decisionsMade: string[]
}

export interface ProjectMemory extends MemoryNode {
  kind: 'project'
  entityRef: string
  milestones: { at: string; what: string; status: 'hit' | 'missed' | 'pending' }[]
  blockers: string[]
  lessonsLearned: string[]
}

export interface PersonMemory extends MemoryNode {
  kind: 'person'
  entityRef: string
  workingPreferences: string[]
  strengths: string[]
  coachingHistory: { at: string; theme: string; outcome?: string }[]
}

export interface LessonMemory extends MemoryNode {
  kind: 'lesson'
  rule: string
  scar: string
  learnedFrom: string[]
  triggerTags: string[]
  appliesWhen: string
  active: boolean
  /** Wisdom requires a human to have said "yes, this is now how we operate". */
  approvedBy?: string
  approvedAt?: string
}

/**
 * EXECUTIVE memory. Not what happened — what this executive concluded, and applies again.
 * Foreshadows the Persona Engine: judgment is personal, and must be attributed.
 */
export interface JudgmentMemory extends MemoryNode {
  kind: 'judgment'
  layer: 'executive'
  /** The situation that invokes this judgment. */
  trigger: string
  /** What the executive does. */
  judgment: string
  /** The experience that produced it — judgment without a reason is just bias. */
  because: string
  learnedFrom: string[]
  heldBy: string
  triggerTags: string[]
  timesApplied: number
}

export type AnyMemory =
  | MemoryNode | DecisionMemory | MeetingMemory | ProjectMemory
  | PersonMemory | LessonMemory | JudgmentMemory

export type RelationType =
  | 'caused' | 'led_to' | 'evidence_for' | 'decided_in' | 'about'
  | 'learned_from' | 'constrains' | 'supersedes' | 'blocked_by'
  /** Decision lineage — the ancestry that explains why a recommendation exists. */
  | 'depends_on'
  /** New knowledge contradicts existing knowledge. */
  | 'contradicts'
  /** A record broke an assumption. */
  | 'invalidates'

export interface MemoryRelation {
  from: string
  to: string
  relation: RelationType
  provenance: Provenance
}

/**
 * Wisdom is not authored — it accretes. A pattern repeats, the system PROPOSES a lesson,
 * and a human decides whether it becomes how the organization operates.
 */
export interface WisdomCandidate {
  id: string
  proposedRule: string
  pattern: string
  occurrences: { nodeId: string; at: string; title: string }[]
  occurrenceCount: number
  status: 'candidate' | 'approved' | 'rejected'
  proposedAt: string
  reviewedBy?: string
  reviewedAt?: string
  triggerTags: string[]
  scar: string
}

// --- Recall (the output contract) ------------------------------------------
export interface BasisItem {
  nodeId: string
  fact: string
  provenance: Provenance
  /** Surfaced so the executive can weigh a stale source differently. */
  lifecycle?: LifecycleState
}

export interface RecallAnswer {
  question: string
  answer: string
  basis: BasisItem[]
  timeline: { at: string; what: string; nodeId: string }[]
  lessons: { id: string; rule: string; scar: string }[]
  /** This executive's own judgment that applies here (executive layer). */
  judgments: { id: string; trigger: string; judgment: string; because: string }[]
  confidence: 'high' | 'medium' | 'low'
  /** Multidimensional confidence of the primary record, when there is one. */
  confidenceDetail?: Confidence
  /** Whether the recalled decision still holds, and why not. */
  validity?: { state: Validity; brokenAssumptions: string[] }
  /** Why this exists — decision ancestry. */
  lineage?: { id: string; title: string; lifecycle: LifecycleState }[]
  gaps: string[]
  redactions: { count: number; reason: string }
}
