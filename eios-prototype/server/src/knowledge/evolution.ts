import type { MemoryFabric } from '../memory/fabric.js'
import { OPEN_ACCESS } from '../memory/fabric.js'
import type { AnyMemory, DecisionMemory, MemoryNode } from '../memory/model.js'
import type { OrgEvent } from '../perception/events.js'
import { computeConfidence } from './confidence.js'
import { refreshNode, supersede, breakAssumption, validityOf } from './lifecycle.js'
import { wisdomEngine, resembles } from './wisdom.js'
import { knowledgeQuality } from './quality.js'
import { bus } from '../events/bus.js'

// Organizational Knowledge Evolution.
//
// "Memory isn't something you query. It's something that continuously evolves."
//
// This service is the answer to that. On every heartbeat, and on every incoming
// observation, knowledge:
//   1. CAPTURES     — significant events become institutional records automatically
//   2. DETECTS CONFLICT — new information that contradicts what we believed
//   3. SUPERSEDES   — old assumptions are retired, not left to rot alongside the new
//   4. PROPOSES     — repeated patterns become candidate wisdom for human review
//   5. RESCORES     — ages knowledge and recomputes quality
//
// Nothing here concludes on the executive's behalf. It keeps the knowledge base honest
// so that a future reasoning engine can rely on it.

export interface EvolutionResult {
  captured: string[]
  conflicts: { nodeId: string; with: string; detail: string }[]
  superseded: { oldId: string; newId: string }[]
  assumptionsBroken: { decisionId: string; assumption: string; by: string }[]
  candidatesProposed: string[]
}

/** Thresholds at which a raw observation is materially significant enough to remember. */
const CAPTURE_RULES: Record<string, (e: OrgEvent) => { title: string; tags: string[]; summary: string } | null> = {
  'channel.metric': (e) => {
    const rate = Number(e.data.successRate ?? 100)
    if (e.data.status !== 'critical' && rate >= 95) return null
    return {
      title: `${e.entityId.toUpperCase()} degraded to ${rate.toFixed(1)}%`,
      tags: [e.entityId, 'incident', 'outage', 'channel'],
      summary: `Observed by ${e.source}: ${e.entityId} success rate ${rate.toFixed(1)}% (${e.data.status ?? 'degraded'}).`,
    }
  },
  'vendor.sla': (e) => {
    if (e.data.breach !== true) return null
    return {
      title: `${e.entityId} SLA breach (${Number(e.data.slaAttainment ?? 0).toFixed(1)}%)`,
      tags: [e.entityId.toLowerCase(), 'breach', 'vendor', 'sla'],
      summary: `Observed by ${e.source}: SLA breach recorded for ${e.entityId}.`,
    }
  },
}

export class KnowledgeEvolution {
  private fabric: MemoryFabric
  private seq = 0
  private capturedSignatures = new Set<string>()

  constructor(fabric: MemoryFabric) {
    this.fabric = fabric
  }

  /**
   * (1) AUTOMATIC CAPTURE — a material observation becomes an institutional record
   * without anyone writing it down. This is how memory accretes rather than being authored.
   */
  onEvent(e: OrgEvent): EvolutionResult {
    const result: EvolutionResult = {
      captured: [], conflicts: [], superseded: [], assumptionsBroken: [], candidatesProposed: [],
    }

    const rule = CAPTURE_RULES[e.kind]
    const capture = rule?.(e)
    if (capture) {
      // Don't re-record the same condition every heartbeat — memory, not a log.
      const signature = `${e.kind}|${e.entityId}|${capture.title}`
      if (!this.capturedSignatures.has(signature)) {
        this.capturedSignatures.add(signature)
        const node: MemoryNode = {
          id: `AC-${++this.seq}`, kind: 'event', layer: 'organizational',
          title: capture.title, at: e.at.slice(0, 10), summary: capture.summary,
          tags: capture.tags, sensitivity: 'open', lifecycle: 'active',
          confidence: computeConfidence({
            evidence: e.source === 'synthetic' ? 0.5 : 0.9, // synthetic data is weaker evidence, and says so
            reasoning: 0.85, policy: 0.8, freshness: 1,
            humanValidation: 'unvalidated', // captured automatically — nobody has confirmed it
          }),
          provenance: {
            source: `${e.source} event ${e.id}`, recordedAt: e.at,
            recordedBy: 'Knowledge Evolution (automatic capture)', confidence: 'derived',
          },
          lastVerifiedAt: e.at,
        }
        this.fabric.add(node)
        result.captured.push(node.id)

        // "This resembles Lesson L-1 from the Diwali 2025 outage."
        const matches = resembles(this.fabric, node)
        if (matches.length) {
          bus.publish('knowledge.resembles', {
            actor: 'EIOS', actorRole: 'system', resource: node.id,
            detail: `${node.title} resembles ${matches[0].lesson.id}: ${matches[0].lesson.rule}`,
          })
        }
      }
    }

    // (2)(3) conflict + supersession, (4) proposal
    result.conflicts.push(...this.detectConflicts())
    result.superseded.push(...this.applySupersession())
    result.assumptionsBroken.push(...this.checkAssumptions())
    result.candidatesProposed.push(...wisdomEngine.propose(this.fabric).map((c) => c.id))
    return result
  }

  /**
   * (2) CONFLICT DETECTION — knowledge that contradicts other knowledge must not sit
   * quietly side by side. A `contradicts` edge marks BOTH records disputed, which caps
   * their confidence at 40% until a human resolves it.
   */
  private detectConflicts(): EvolutionResult['conflicts'] {
    const found: EvolutionResult['conflicts'] = []
    for (const n of this.fabric.all(OPEN_ACCESS)) {
      for (const { node: other } of this.fabric.neighbors(n.id, 'contradicts', OPEN_ACCESS)) {
        if (n.confidence.humanValidation === 'disputed' && other.confidence.humanValidation === 'disputed') continue
        for (const x of [n, other]) {
          x.confidence = computeConfidence({ ...x.confidence, humanValidation: 'disputed' })
        }
        found.push({ nodeId: n.id, with: other.id, detail: `"${n.title}" contradicts "${other.title}" — both marked disputed pending human resolution.` })
      }
    }
    return found
  }

  /** (3) SUPERSESSION — newer record on the same subject retires the older one. */
  private applySupersession(): EvolutionResult['superseded'] {
    const done: EvolutionResult['superseded'] = []
    for (const n of this.fabric.all(OPEN_ACCESS)) {
      for (const { node: older } of this.fabric.neighbors(n.id, 'supersedes', OPEN_ACCESS)) {
        if (older.lifecycle === 'superseded') continue
        supersede(older, n)
        done.push({ oldId: older.id, newId: n.id })
        bus.publish('knowledge.superseded', {
          actor: 'EIOS', actorRole: 'system', resource: older.id,
          detail: `"${older.title}" superseded by "${n.title}"`,
        })
      }
    }
    return done
  }

  /**
   * An `invalidates` edge from a record to a decision breaks the named assumption.
   * The decision's validity then degrades — and the executive is told, unprompted.
   */
  private checkAssumptions(): EvolutionResult['assumptionsBroken'] {
    const broken: EvolutionResult['assumptionsBroken'] = []
    for (const n of this.fabric.all(OPEN_ACCESS)) {
      for (const { node: target, rel } of this.fabric.neighbors(n.id, 'invalidates', OPEN_ACCESS)) {
        if (target.kind !== 'decision') continue
        const d = target as DecisionMemory
        // The assumption id travels on the edge's provenance source: "assumption:<id>"
        const assumptionId = rel.provenance.source.startsWith('assumption:')
          ? rel.provenance.source.slice('assumption:'.length)
          : d.assumptions.find((a) => a.status !== 'broken')?.id
        if (!assumptionId) continue
        if (breakAssumption(d, assumptionId, n.id)) {
          const a = d.assumptions.find((x) => x.id === assumptionId)!
          broken.push({ decisionId: d.id, assumption: a.text, by: n.id })
          const v = validityOf(d)
          bus.publish('knowledge.assumption_broken', {
            actor: 'EIOS', actorRole: 'system', resource: d.id,
            detail: `Assumption broken by ${n.id}: "${a.text}" — ${d.id} is now ${v.state}.`,
          })
        }
      }
    }
    return broken
  }

  /**
   * (5) The heartbeat. Knowledge ages whether or not anyone queries it — that is what
   * makes this a living system rather than a database.
   */
  tick(now = new Date()): { aged: number; quality: number; candidates: number } {
    let aged = 0
    for (const n of this.fabric.all(OPEN_ACCESS)) {
      const before = n.lifecycle
      refreshNode(n as AnyMemory, now)
      if (n.lifecycle !== before) {
        aged += 1
        bus.publish('knowledge.aged', {
          actor: 'EIOS', actorRole: 'system', resource: n.id,
          detail: `"${n.title}" ${before} → ${n.lifecycle}`,
        })
      }
    }
    const candidates = wisdomEngine.propose(this.fabric).length
    const quality = knowledgeQuality(this.fabric).overall
    return { aged, quality, candidates }
  }
}
