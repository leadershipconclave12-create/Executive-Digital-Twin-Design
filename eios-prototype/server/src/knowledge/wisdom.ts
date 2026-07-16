import type { MemoryFabric, AccessContext } from '../memory/fabric.js'
import { OPEN_ACCESS } from '../memory/fabric.js'
import type { AnyMemory, LessonMemory, WisdomCandidate } from '../memory/model.js'
import { computeConfidence } from './confidence.js'

// Organizational Wisdom.
//
//   Incident → RCA → Pattern → Repeated 3× → Candidate lesson → HUMAN APPROVES → Wisdom
//
// This is the difference between retrieval and wisdom. Retrieval finds the Diwali RCA.
// Wisdom says "this resembles L-1 from Diwali 2025 — we have a rule about this."
//
// Two commitments:
//  1. The system PROPOSES; a human DISPOSES. Nothing becomes organizational wisdom
//     because a model inferred it. Candidates sit in `awaiting_validation` until a named
//     human approves — and the approval is recorded.
//  2. Wisdom carries its SCAR. A rule without its cost gets argued away in the next
//     meeting; "4.2M failed transactions" does not.

/** Signature tags that indicate a recurring operational pattern worth learning from. */
const PATTERN_DIMENSIONS = [
  'incident', 'outage', 'delay', 'breach', 'escalation', 'churn', 'rollback', 'capacity',
]

const REPETITION_THRESHOLD = 3

export interface PatternGroup {
  signature: string
  members: AnyMemory[]
}

/**
 * Group institutional episodes by their shared operational signature. Deliberately simple
 * and explainable: a co-occurring tag pair. A learned clusterer would fit here behind the
 * same interface — but it must remain inspectable, because it proposes org policy.
 */
export function detectPatterns(fabric: MemoryFabric, ctx: AccessContext = OPEN_ACCESS): PatternGroup[] {
  const events = fabric.byKind('event', ctx)
  const groups = new Map<string, AnyMemory[]>()

  for (const e of events) {
    const dims = e.tags.filter((t) => PATTERN_DIMENSIONS.includes(t))
    const context = e.tags.filter((t) => !PATTERN_DIMENSIONS.includes(t))
    for (const d of dims) {
      for (const c of context) {
        const sig = `${d}+${c}`
        const list = groups.get(sig) ?? []
        list.push(e)
        groups.set(sig, list)
      }
    }
  }
  return [...groups.entries()]
    .map(([signature, members]) => ({ signature, members }))
    .filter((g) => g.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length)
}

export class WisdomEngine {
  private candidates = new Map<string, WisdomCandidate>()
  private seq = 0

  /**
   * Propose candidate wisdom where a pattern has repeated enough to be a rule rather
   * than a coincidence. Idempotent: re-running updates occurrences, never duplicates.
   */
  propose(fabric: MemoryFabric, ctx: AccessContext = OPEN_ACCESS): WisdomCandidate[] {
    const proposed: WisdomCandidate[] = []

    for (const group of detectPatterns(fabric, ctx)) {
      if (group.members.length < REPETITION_THRESHOLD) continue

      // Don't propose what the organization already knows.
      const [dim, context] = group.signature.split('+')
      const covered = fabric.byKind<LessonMemory>('lesson', ctx)
        .some((l) => l.active && l.triggerTags.includes(context) && l.triggerTags.includes(dim))
      if (covered) continue

      const existing = [...this.candidates.values()].find((c) => c.pattern === group.signature)
      if (existing) {
        existing.occurrences = group.members.map((m) => ({ nodeId: m.id, at: m.at, title: m.title }))
        existing.occurrenceCount = group.members.length
        continue
      }

      const id = `W-${++this.seq}`
      const candidate: WisdomCandidate = {
        id,
        pattern: group.signature,
        proposedRule:
          `Recurring "${dim}" affecting "${context}" — observed ${group.members.length} times. ` +
          `Treat ${context} ${dim} as a systemic pattern, not an isolated event.`,
        occurrences: group.members.map((m) => ({ nodeId: m.id, at: m.at, title: m.title })),
        occurrenceCount: group.members.length,
        // NOT wisdom yet. A human must decide.
        status: 'candidate',
        proposedAt: new Date().toISOString(),
        triggerTags: [dim, context],
        scar: group.members.map((m) => m.title).join('; '),
      }
      this.candidates.set(id, candidate)
      proposed.push(candidate)
    }
    return proposed
  }

  list(): WisdomCandidate[] {
    return [...this.candidates.values()].sort((a, b) => b.occurrenceCount - a.occurrenceCount)
  }

  get(id: string): WisdomCandidate | undefined {
    return this.candidates.get(id)
  }

  /**
   * A human turns a candidate into organizational wisdom. The approver and time are
   * recorded on the lesson — wisdom is attributable, not anonymous.
   */
  approve(fabric: MemoryFabric, id: string, approvedBy: string, rule?: string): LessonMemory | { error: string } {
    const c = this.candidates.get(id)
    if (!c) return { error: `No wisdom candidate '${id}'` }
    if (c.status !== 'candidate') return { error: `Candidate '${id}' is already ${c.status}` }

    c.status = 'approved'
    c.reviewedBy = approvedBy
    c.reviewedAt = new Date().toISOString()

    const lesson: LessonMemory = {
      id: `L-${id}`, kind: 'lesson', layer: 'organizational',
      title: rule ?? c.proposedRule,
      at: new Date().toISOString().slice(0, 10),
      summary: `Wisdom promoted from repeated pattern "${c.pattern}" (${c.occurrenceCount} occurrences).`,
      tags: c.triggerTags,
      sensitivity: 'open',
      lifecycle: 'active',
      confidence: computeConfidence({
        evidence: Math.min(0.95, 0.6 + c.occurrenceCount * 0.1), // repetition IS the evidence
        reasoning: 0.8, policy: 0.9, freshness: 1,
        humanValidation: 'validated', // a human just approved it — that is the point
      }),
      provenance: {
        source: `Wisdom candidate ${c.id} (${c.occurrenceCount} occurrences)`,
        recordedAt: new Date().toISOString(),
        recordedBy: approvedBy,
        confidence: 'derived',
      },
      rule: rule ?? c.proposedRule,
      scar: c.scar,
      learnedFrom: c.occurrences.map((o) => o.nodeId),
      triggerTags: c.triggerTags,
      appliesWhen: `A "${c.triggerTags[0]}" event affects "${c.triggerTags[1]}"`,
      active: true,
      approvedBy,
      approvedAt: new Date().toISOString(),
    }
    fabric.add(lesson)
    for (const o of c.occurrences) {
      fabric.link({
        from: lesson.id, to: o.nodeId, relation: 'learned_from',
        provenance: lesson.provenance,
      })
    }
    return lesson
  }

  reject(id: string, by: string): boolean {
    const c = this.candidates.get(id)
    if (!c || c.status !== 'candidate') return false
    c.status = 'rejected'
    c.reviewedBy = by
    c.reviewedAt = new Date().toISOString()
    return true
  }
}

/**
 * "This resembles Lesson L-1 from the Diwali 2025 outage."
 * Beyond retrieval: recognising that a live situation matches institutional scar tissue.
 */
export function resembles(fabric: MemoryFabric, node: AnyMemory, ctx: AccessContext = OPEN_ACCESS): { lesson: LessonMemory; overlap: string[] }[] {
  return fabric.byKind<LessonMemory>('lesson', ctx)
    .filter((l) => l.active && l.lifecycle === 'active')
    .map((l) => ({ lesson: l, overlap: l.triggerTags.filter((t) => node.tags.includes(t)) }))
    .filter((m) => m.overlap.length >= 2) // one shared tag is a coincidence; two is a signal
    .sort((a, b) => b.overlap.length - a.overlap.length)
}

export const wisdomEngine = new WisdomEngine()
