import { describe, it, expect } from 'vitest'
import { seedMemory, memory } from '../memory/seed.js'
import { recall } from '../memory/recall.js'
import { OPEN_ACCESS, HUMAN_ACCESS, LLM_ACCESS } from '../memory/fabric.js'
import type { DecisionMemory } from '../memory/model.js'
import { OFFICES } from '../twin/offices.js'
import { seedTwin } from '../twin/state.js'
import { runCommand } from '../cognitive/commandService.js'
import { Store } from '../data/store.js'
import { findUser } from '../governance/rbac.js'

const deputy = findUser('u-dc')!

// ===========================================================================
// THE FLAGSHIP: "Why did we reject XYZ Bank's proposal?"
// This must be answerable WITHOUT an LLM — from structure alone.
// ===========================================================================
describe('Decision Memory — "Why did we reject XYZ Bank\'s proposal?"', () => {
  const f = seedMemory()
  const a = recall(f, "Why did we reject XYZ Bank's proposal?", OPEN_ACCESS)

  it('recalls the decision with its date and id', () => {
    expect(a.answer).toContain('D-193')
    expect(a.answer).toMatch(/March 2026|14 March|March 14/)
  })

  it('recalls the full rationale chain in order', () => {
    expect(a.answer).toContain('Merchant adoption risk')
    expect(a.answer).toContain('Fraud concern')
    expect(a.answer).toContain('Engineering estimate doubled')
    expect(a.answer).toContain('Risk Committee approval absent')
  })

  it("recalls the executive's own words verbatim", () => {
    expect(a.answer).toContain("We'll revisit after NPCI publishes the new circular.")
  })

  it('recalls alternatives that were considered and why they were not taken', () => {
    expect(a.answer).toContain('white-label')
    expect(a.basis.some((b) => b.fact.startsWith('Alternative:'))).toBe(true)
  })

  it('identifies the blocking approval gap', () => {
    expect(a.answer).toMatch(/Risk Committee approval absent/i)
  })

  it('volunteers whether the revisit condition has since been met', () => {
    // The NPCI circular is still unpublished — memory should surface that unprompted.
    expect(a.answer).toContain('Revisit condition')
    expect(a.answer).toMatch(/not published|unpublished|has not/i)
  })

  it('traces every claim to a record with provenance (explainability)', () => {
    expect(a.basis.length).toBeGreaterThan(5)
    for (const b of a.basis) {
      expect(b.nodeId).toBeTruthy()
      expect(b.provenance.source).toBeTruthy()
      expect(['stated', 'derived', 'inferred']).toContain(b.provenance.confidence)
    }
  })

  it('returns a chronological timeline of the evidence and the decision', () => {
    expect(a.timeline.length).toBeGreaterThanOrEqual(3)
    const dates = a.timeline.map((t) => t.at)
    expect([...dates].sort()).toEqual(dates) // already chronological
  })

  it('is high confidence and answered without an LLM', () => {
    expect(a.confidence).toBe('high')
  })
})

// ===========================================================================
// Organizational scars — memory as wisdom, not just data
// ===========================================================================
describe('Organizational scars', () => {
  const f = seedMemory()

  it('traces the Diwali causal chain: outage → customer impact → CEO review', () => {
    const a = recall(f, 'what happened during the Diwali outage?', OPEN_ACCESS)
    expect(a.answer).toContain('switch overloaded')
    expect(a.answer).toMatch(/4\.2M|Customers impacted/)
    expect(a.answer).toContain('CEO')
    expect(a.timeline.length).toBeGreaterThanOrEqual(3)
  })

  it('surfaces the rule the organization now lives by', () => {
    const a = recall(f, 'what lessons apply to deploys?', OPEN_ACCESS)
    expect(a.lessons.some((l) => /festival/i.test(l.rule))).toBe(true)
    expect(a.lessons.some((l) => /4\.2M/.test(l.scar))).toBe(true)
  })

  it('traces Release 15: delay → complaints → churn → escalation', () => {
    const a = recall(f, 'what happened with the Release 15 delay?', OPEN_ACCESS)
    expect(a.answer).toContain('complaints')
    expect(a.answer).toMatch(/churn/i)
    expect(a.answer).toContain('CEO')
  })
})

// ===========================================================================
// THE POINT: memory must CHANGE the recommendation
// ===========================================================================
describe('Memory changes recommendations (not just archives them)', () => {
  it('Delivery Office leads with early disclosure (L-2) because Release 15 scarred us', () => {
    const state = seedTwin()
    const delivery = OFFICES.find((o) => o.id === 'delivery')!
    const r = delivery.run(state)
    const missPrediction = r.predictions.find((p) => /miss/i.test(p.title))
    expect(missPrediction).toBeDefined()
    // Without memory this would just say "rebalance capacity".
    expect(missPrediction!.recommendation).toMatch(/disclose/i)
    expect(missPrediction!.precedent?.some((p) => p.lessonId === 'L-2')).toBe(true)
  })

  it('Engineering Office attaches festival-freeze precedent to the release go/no-go', () => {
    const state = seedTwin()
    const eng = OFFICES.find((o) => o.id === 'engineering')!
    const r = eng.run(state)
    const pred = r.predictions[0]
    expect(pred?.precedent?.length).toBeGreaterThan(0)
    expect(pred!.recommendation).toMatch(/precedent/i)
  })

  it('carries the scar (the cost) alongside the rule, not just the rule', () => {
    const state = seedTwin()
    const r = OFFICES.find((o) => o.id === 'delivery')!.run(state)
    const p = r.predictions.find((x) => x.precedent?.length)
    expect(p!.precedent![0].scar).toBeTruthy()
  })
})

// ===========================================================================
// Governance, SINGLE USER: the boundary is no longer human-vs-human.
// It is THIS MACHINE vs THE MODEL. A local read cannot leak; a prompt can.
// ===========================================================================
describe('LLM egress governance (DPDPA)', () => {
  it('the executive reads his own personal notes — it is his data', () => {
    expect(memory.get('PE-B', HUMAN_ACCESS)).toBeDefined()
  })

  it('but personal People Memory is NEVER sent to a model', () => {
    // PE-B is 1:1 coaching notes about a named engineer. Useful to the model.
    // Irrelevant — it does not leave this machine.
    expect(memory.get('PE-B', LLM_ACCESS)).toBeUndefined()
  })

  it('restricted records (CEO review, churn numbers) are never sent to a model', () => {
    expect(memory.get('EV-303', HUMAN_ACCESS)).toBeDefined()
    expect(memory.get('EV-303', LLM_ACCESS)).toBeUndefined()
  })

  it('open institutional records DO go to the model — the boundary is not a blanket ban', () => {
    expect(memory.get('D-193', LLM_ACCESS)).toBeDefined()
  })

  it('reports exactly what is held back from the model', () => {
    const withheld = memory.llmWithheld()
    expect(withheld.length).toBeGreaterThan(0)
    expect(withheld.every((n) => n.sensitivity !== 'open')).toBe(true)
  })

  it('tells the model that records exist but are withheld — rather than hiding the gap', () => {
    const a = recall(memory, 'tell me about EM-B', LLM_ACCESS)
    expect(a.redactions.count).toBeGreaterThan(0)
    expect(a.redactions.reason).toMatch(/withheld/i)
  })

  it('a lesson learned from a restricted record is still usable — only the record is held', () => {
    // L-2 was learned from EV-212/EV-213 (restricted churn + CEO escalation).
    // The RULE is shareable; the underlying record is not.
    expect(memory.get('L-2', LLM_ACCESS)).toBeDefined()
  })
})

// ===========================================================================
// Honesty — memory must not bluff
// ===========================================================================
describe('Memory honesty', () => {
  it('admits when it has no record instead of guessing', () => {
    const a = recall(seedMemory(), 'why did we acquire the Antarctic branch network?', OPEN_ACCESS)
    expect(a.confidence).toBe('low')
    expect(a.answer).toMatch(/no record|won't guess/i)
    expect(a.gaps.length).toBeGreaterThan(0)
    expect(a.basis).toHaveLength(0)
  })

  it('marks derived facts differently from stated ones', () => {
    const f = seedMemory()
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    expect(d.provenance.confidence).toBe('stated')
    const churn = f.get('EV-212', OPEN_ACCESS)!
    expect(churn.provenance.confidence).toBe('derived')
  })
})

// ===========================================================================
// Fabric structure — the graph is the source of truth
// ===========================================================================
describe('Memory fabric structure', () => {
  const f = seedMemory()

  it('search is only an entry-point aid; the graph carries the answer', () => {
    const hits = f.search('xyz bank', OPEN_ACCESS)
    expect(hits.length).toBeGreaterThan(0)
    // The decision's substance lives in the structure, not the search ranking.
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    expect(d.rationale.length).toBe(4)
    expect(d.alternatives.length).toBe(3)
  })

  it('builds a chronological timeline for a twin entity', () => {
    const t = f.timeline('PRJ-A', OPEN_ACCESS)
    expect(t.length).toBeGreaterThan(0)
  })

  it('links lessons to the episodes that taught them', () => {
    const n = f.neighbors('L-1', 'learned_from', OPEN_ACCESS)
    expect(n.some((x) => x.node.id === 'EV-301')).toBe(true)
  })

  it('reports fabric stats by kind and sensitivity', () => {
    const s = f.stats()
    expect(s.nodes).toBeGreaterThan(10)
    expect(s.byKind.decision).toBeGreaterThan(0)
    expect(s.byKind.lesson).toBeGreaterThan(0)
    expect(s.bySensitivity.personal).toBeGreaterThan(0)
  })
})

// ===========================================================================
// One Prompt integration
// ===========================================================================
describe('One Prompt recall', () => {
  it('answers the XYZ Bank question conversationally with sources', async () => {
    const r = await runCommand(new Store(), deputy, 'why did we reject XYZ Bank?')
    expect(r.blocked).toBeFalsy()
    expect(r.reply).toContain('D-193')
    expect(r.reply).toMatch(/sources, confidence high/)
  })

  it('answers from local memory with no model call — recall is free', async () => {
    const r = await runCommand(new Store(), deputy, 'why did we reject XYZ Bank?')
    expect(r.meta).toBeUndefined()
  })

  it('the executive can see his own personal notes through One Prompt', async () => {
    const r = await runCommand(new Store(), deputy, 'what do we remember about EM-B?')
    // No role gating: it is his memory. The gate is on what leaves for the model.
    expect(r.blocked).toBeFalsy()
  })
})
