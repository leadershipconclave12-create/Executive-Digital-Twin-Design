import type { MemoryFabric, AccessContext } from '../memory/fabric.js'
import { OPEN_ACCESS } from '../memory/fabric.js'
import type { AnyMemory, LifecycleState } from '../memory/model.js'

// Decision lineage — the ancestry that explains WHY a recommendation exists.
//
//   Roadmap 2027 → depends_on → NPCI Circular → depends_on → Architecture Review
//                → depends_on → Capacity Decision → depends_on → Budget Approval
//
// The payoff is not the pretty chain. It is INVALIDATION PROPAGATION: when the Budget
// Approval is superseded, the system knows four downstream decisions are resting on a
// foundation that moved — and can tell the executive before they find out the hard way.

export interface LineageLink {
  id: string
  title: string
  lifecycle: LifecycleState
  depth: number
}

/** Walk backwards through `depends_on`: what this decision rests on. */
export function ancestry(fabric: MemoryFabric, id: string, ctx: AccessContext = OPEN_ACCESS, maxDepth = 8): LineageLink[] {
  const out: LineageLink[] = []
  const seen = new Set<string>([id])
  let frontier = [id]
  let depth = 0

  while (frontier.length && depth < maxDepth) {
    depth += 1
    const next: string[] = []
    for (const cur of frontier) {
      for (const { node } of fabric.neighbors(cur, 'depends_on', ctx)) {
        if (seen.has(node.id)) continue
        seen.add(node.id)
        out.push({ id: node.id, title: node.title, lifecycle: node.lifecycle, depth })
        next.push(node.id)
      }
    }
    frontier = next
  }
  return out
}

/** Walk forwards: what rests on THIS. The blast radius if it moves. */
export function descendants(fabric: MemoryFabric, id: string, ctx: AccessContext = OPEN_ACCESS, maxDepth = 8): LineageLink[] {
  const out: LineageLink[] = []
  const seen = new Set<string>([id])
  let frontier = [id]
  let depth = 0

  while (frontier.length && depth < maxDepth) {
    depth += 1
    const next: string[] = []
    for (const cur of frontier) {
      // Reverse edge lookup: nodes that depend_on `cur`.
      for (const n of fabric.all(ctx)) {
        if (seen.has(n.id)) continue
        const dependsOnCur = fabric.neighbors(n.id, 'depends_on', ctx).some((x) => x.node.id === cur)
        if (dependsOnCur) {
          seen.add(n.id)
          out.push({ id: n.id, title: n.title, lifecycle: n.lifecycle, depth })
          next.push(n.id)
        }
      }
    }
    frontier = next
  }
  return out
}

export interface InvalidationRisk {
  node: { id: string; title: string }
  /** The ancestor that moved. */
  cause: { id: string; title: string; lifecycle: LifecycleState }
  severity: 'at_risk' | 'invalid'
  reason: string
}

/**
 * The point of lineage. Find every record resting on an ancestor that has been
 * superseded/obsoleted — i.e. conclusions still being trusted on a foundation that moved.
 */
export function invalidationRisks(fabric: MemoryFabric, ctx: AccessContext = OPEN_ACCESS): InvalidationRisk[] {
  const risks: InvalidationRisk[] = []
  for (const node of fabric.all(ctx)) {
    if (node.lifecycle === 'archived' || node.lifecycle === 'obsolete') continue
    for (const a of ancestry(fabric, node.id, ctx)) {
      if (a.lifecycle === 'superseded' || a.lifecycle === 'obsolete') {
        risks.push({
          node: { id: node.id, title: node.title },
          cause: { id: a.id, title: a.title, lifecycle: a.lifecycle },
          severity: a.depth === 1 ? 'invalid' : 'at_risk',
          reason: `Rests on "${a.title}" (${a.lifecycle}) ${a.depth} step${a.depth > 1 ? 's' : ''} up the lineage.`,
        })
      }
    }
  }
  return risks
}

/** Narrate the chain for an executive: "X exists because of Y, which exists because of Z." */
export function explainLineage(fabric: MemoryFabric, id: string, ctx: AccessContext = OPEN_ACCESS): string {
  const node: AnyMemory | undefined = fabric.get(id, ctx)
  if (!node) return `No visible record '${id}'.`
  const chain = ancestry(fabric, id, ctx)
  if (!chain.length) return `${node.title} — no recorded dependencies; it stands on its own.`
  const parts = chain.map((l) => `${l.title}${l.lifecycle !== 'active' ? ` [${l.lifecycle}]` : ''}`)
  return `${node.title} rests on → ${parts.join(' → ')}.`
}
