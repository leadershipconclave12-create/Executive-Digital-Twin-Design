import type {
  AnyMemory, MemoryNode, MemoryRelation, RelationType, LessonMemory, JudgmentMemory,
  Sensitivity, LifecycleState,
} from './model.js'
import { computeConfidence } from '../knowledge/confidence.js'

// The Memory Fabric: a structured, explainable graph. Entities + typed relations +
// a temporal index. Retrieval is graph traversal; lexical search is only an entry-point
// finder. Nothing here embeds or guesses.

/**
 * Who — or WHAT — is reading the fabric.
 *
 * This used to be human-vs-human access control. With a single user that is theatre: it
 * is his organization, his notes, his memory. He sees everything.
 *
 * So the boundary was repurposed to the one that actually still exists:
 *
 *   HUMAN_ACCESS — the Deputy Chief. Sees everything. It is his data.
 *   LLM_ACCESS   — a prompt bound for an external model. Personal and restricted records
 *                  MUST NOT leave this machine, no matter how useful they would be.
 *
 * This is a stronger boundary than the one it replaced, because it is the one that can
 * actually be violated: an LLM call crosses a network and a company boundary. A local
 * read does not.
 */
export interface AccessContext {
  /** May see `personal` records (People Memory — 1:1 notes, coaching). */
  canSeePersonal: boolean
  /** May see `restricted` records (CEO reviews, churn numbers, board matters). */
  canSeeRestricted: boolean
  /** Label for diagnostics — who is asking. */
  readonly as?: string
}

/** The executive reading his own memory. Sees everything. */
export const HUMAN_ACCESS: AccessContext = { canSeePersonal: true, canSeeRestricted: true, as: 'executive' }

/**
 * Context assembled for an EXTERNAL MODEL. Personal and restricted records are withheld
 * — a coaching note about a named engineer has no business in a prompt leaving the bank,
 * and DPDPA does not care how good the answer would have been.
 */
export const LLM_ACCESS: AccessContext = { canSeePersonal: false, canSeeRestricted: false, as: 'llm' }

/** @deprecated Use HUMAN_ACCESS. Kept as an alias so callers/tests read clearly. */
export const OPEN_ACCESS: AccessContext = HUMAN_ACCESS

const STOP = new Set([
  'the', 'a', 'an', 'we', 'did', 'do', 'why', 'what', 'when', 'who', 'was', 'were', 'is',
  'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'that', 'this', 'our', 'about', 'with',
  'happened', 'tell', 'me', 'show', 'i', 'you', 'how',
])

const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t))

export class MemoryFabric {
  private nodes = new Map<string, AnyMemory>()
  private relations: MemoryRelation[] = []

  /**
   * Normalize on write so no record can enter the fabric without lifecycle semantics.
   * A node without a layer/lifecycle/confidence is a record; a node with them is
   * knowledge. The fabric refuses to store the former.
   */
  add(node: AnyMemory): void {
    const n = node as MemoryNode
    if (!n.layer) n.layer = n.kind === 'judgment' ? 'executive' : 'organizational'
    if (!n.lifecycle) n.lifecycle = 'active'
    if (!n.confidence) {
      n.confidence = computeConfidence({
        evidence: n.provenance?.confidence === 'stated' ? 0.9 : n.provenance?.confidence === 'derived' ? 0.75 : 0.5,
        reasoning: 0.8, policy: 0.8, freshness: 1,
        humanValidation: 'unvalidated',
      })
    }
    this.nodes.set(node.id, node)
  }

  link(rel: MemoryRelation): void {
    this.relations.push(rel)
  }

  /** Visibility gate — governance is enforced at the fabric, not in the UI. */
  private visible(node: AnyMemory, ctx: AccessContext): boolean {
    if (node.sensitivity === 'personal') return ctx.canSeePersonal
    if (node.sensitivity === 'restricted') return ctx.canSeeRestricted
    return true
  }

  /** Records withheld from this consumer — reported, never silently dropped. */
  countRedacted(candidates: AnyMemory[], ctx: AccessContext): number {
    return candidates.filter((n) => !this.visible(n, ctx)).length
  }

  /** What would be withheld from an LLM prompt. Useful for showing the executive. */
  llmWithheld(): AnyMemory[] {
    return this.all(HUMAN_ACCESS).filter((n) => !this.visible(n, LLM_ACCESS))
  }

  get(id: string, ctx: AccessContext = OPEN_ACCESS): AnyMemory | undefined {
    const n = this.nodes.get(id)
    return n && this.visible(n, ctx) ? n : undefined
  }

  all(ctx: AccessContext = OPEN_ACCESS): AnyMemory[] {
    return [...this.nodes.values()].filter((n) => this.visible(n, ctx))
  }

  byKind<T extends AnyMemory = AnyMemory>(kind: MemoryNode['kind'], ctx: AccessContext = OPEN_ACCESS): T[] {
    return this.all(ctx).filter((n) => n.kind === kind) as T[]
  }

  /** All records concerning a twin entity (project, person, vendor…), chronologically. */
  timeline(entityRef: string, ctx: AccessContext = OPEN_ACCESS): AnyMemory[] {
    const direct = this.relations
      .filter((r) => r.relation === 'about' && r.to === entityRef)
      .map((r) => this.nodes.get(r.from))
      .filter((n): n is AnyMemory => Boolean(n))
    const tagged = this.all().filter((n) => n.tags.includes(entityRef.toLowerCase()))
    const set = new Map<string, AnyMemory>()
    for (const n of [...direct, ...tagged]) if (this.visible(n, ctx)) set.set(n.id, n)
    return [...set.values()].sort((a, b) => a.at.localeCompare(b.at))
  }

  neighbors(id: string, relation?: RelationType, ctx: AccessContext = OPEN_ACCESS): { rel: MemoryRelation; node: AnyMemory }[] {
    return this.relations
      .filter((r) => r.from === id && (!relation || r.relation === relation))
      .map((r) => ({ rel: r, node: this.nodes.get(r.to) }))
      .filter((x): x is { rel: MemoryRelation; node: AnyMemory } => Boolean(x.node) && this.visible(x.node!, ctx))
  }

  /**
   * Walk the causal chain forward: incident → led_to → churn → led_to → escalation.
   * This is what turns a log into a story an executive can act on.
   */
  trace(id: string, ctx: AccessContext = OPEN_ACCESS, depth = 6): AnyMemory[] {
    const chain: AnyMemory[] = []
    const seen = new Set<string>()
    let cursor = this.nodes.get(id)
    while (cursor && depth-- > 0 && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      if (this.visible(cursor, ctx)) chain.push(cursor)
      const next = this.relations.find(
        (r) => r.from === cursor!.id && (r.relation === 'caused' || r.relation === 'led_to'),
      )
      cursor = next ? this.nodes.get(next.to) : undefined
    }
    return chain
  }

  /**
   * RETRIEVAL AID ONLY. Lexical scoring to locate an entry point in the graph.
   * The answer always comes from traversing structure, never from this ranking.
   * (A vector index would slot in here as a better aid — same contract, not truth.)
   */
  search(query: string, ctx: AccessContext = OPEN_ACCESS, limit = 5): AnyMemory[] {
    const q = tokenize(query)
    if (!q.length) return []
    const scored = this.all(ctx).map((n) => {
      const hay = tokenize(`${n.title} ${n.summary} ${n.tags.join(' ')}`)
      let score = 0
      for (const t of q) {
        if (n.tags.includes(t)) score += 3
        if (tokenize(n.title).includes(t)) score += 2
        else if (hay.includes(t)) score += 1
      }
      return { n, score }
    })
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.n)
  }

  /**
   * Active lessons whose triggers intersect the given context tags.
   * Lifecycle-aware: superseded/obsolete wisdom must never steer a live recommendation.
   */
  lessonsFor(tags: string[], ctx: AccessContext = OPEN_ACCESS): LessonMemory[] {
    const t = tags.map((x) => x.toLowerCase())
    return this.byKind<LessonMemory>('lesson', ctx)
      .filter((l) => l.active && this.isUsable(l.lifecycle))
      .filter((l) => l.triggerTags.some((tt) => t.includes(tt.toLowerCase())))
  }

  /**
   * The EXECUTIVE layer: this executive's own judgment for a situation — distinct from
   * the organization's facts. "Don't switch vendors mid-migration" is not a company fact;
   * it is what this Deputy Chief concluded after being burned once.
   */
  judgmentsFor(tags: string[], ctx: AccessContext = OPEN_ACCESS): JudgmentMemory[] {
    const t = tags.map((x) => x.toLowerCase())
    return this.byKind<JudgmentMemory>('judgment', ctx)
      .filter((j) => this.isUsable(j.lifecycle))
      .filter((j) => j.triggerTags.some((tt) => t.includes(tt.toLowerCase())))
  }

  /** Stale knowledge is still usable (flagged); superseded/obsolete/archived is not. */
  private isUsable(state: LifecycleState): boolean {
    return state === 'active' || state === 'stale'
  }

  /** Records in a given lifecycle state — for the quality/observability surface. */
  byLifecycle(state: LifecycleState, ctx: AccessContext = OPEN_ACCESS): AnyMemory[] {
    return this.all(ctx).filter((n) => n.lifecycle === state)
  }

  stats(): {
    nodes: number; relations: number
    byKind: Record<string, number>
    bySensitivity: Record<Sensitivity, number>
    byLayer: Record<string, number>
    byLifecycle: Record<string, number>
  } {
    const byKind: Record<string, number> = {}
    const bySensitivity = { open: 0, restricted: 0, personal: 0 } as Record<Sensitivity, number>
    const byLayer: Record<string, number> = { organizational: 0, executive: 0 }
    const byLifecycle: Record<string, number> = {}
    for (const n of this.nodes.values()) {
      byKind[n.kind] = (byKind[n.kind] ?? 0) + 1
      bySensitivity[n.sensitivity] += 1
      byLayer[n.layer] = (byLayer[n.layer] ?? 0) + 1
      byLifecycle[n.lifecycle] = (byLifecycle[n.lifecycle] ?? 0) + 1
    }
    return { nodes: this.nodes.size, relations: this.relations.length, byKind, bySensitivity, byLayer, byLifecycle }
  }
}
