import { describe, it, expect, beforeEach } from 'vitest'
import { seedMemory } from '../memory/seed.js'
import { recall } from '../memory/recall.js'
import { OPEN_ACCESS, MemoryFabric } from '../memory/fabric.js'
import { computeConfidence } from '../knowledge/confidence.js'
import { ageNode, refreshNode, supersede, validityOf, breakAssumption, freshnessOf } from '../knowledge/lifecycle.js'
import { ancestry, descendants, invalidationRisks, explainLineage } from '../knowledge/lineage.js'
import { WisdomEngine, resembles } from '../knowledge/wisdom.js'
import { knowledgeQuality } from '../knowledge/quality.js'
import { KnowledgeEvolution } from '../knowledge/evolution.js'
import { makeEvent } from '../perception/events.js'
import type { DecisionMemory, MemoryNode } from '../memory/model.js'
import { statedFactConfidence } from '../knowledge/confidence.js'

const node = (over: Partial<MemoryNode> & { id: string; kind: MemoryNode['kind'] }): MemoryNode => ({
  layer: 'organizational', title: over.id, at: '2026-01-01', summary: '', tags: [],
  sensitivity: 'open', lifecycle: 'active', confidence: statedFactConfidence(),
  provenance: { source: 'test', recordedAt: '2026-01-01', recordedBy: 'test', confidence: 'stated' },
  ...over,
})

// ===========================================================================
// 1. MULTIDIMENSIONAL CONFIDENCE — "why is confidence high or low?"
// ===========================================================================
describe('Multidimensional confidence', () => {
  it('names the dimension holding the score down, not just the score', () => {
    const c = computeConfidence({ evidence: 0.95, reasoning: 0.9, policy: 0.9, freshness: 0.2, humanValidation: 'validated' })
    expect(c.limitedBy).toBe('data freshness')
    expect(c.explanation).toContain('freshness')
  })

  it('refuses to let a strong dimension average away a fatal one', () => {
    const c = computeConfidence({ evidence: 1, reasoning: 1, policy: 1, freshness: 0.1, humanValidation: 'validated' })
    // A plain weighted average would give ~0.82. Weakest-link dominance must not.
    expect(c.overall).toBeLessThan(0.3)
  })

  it('caps disputed knowledge at 40% regardless of everything else', () => {
    const c = computeConfidence({ evidence: 1, reasoning: 1, policy: 1, freshness: 1, humanValidation: 'disputed' })
    expect(c.overall).toBeLessThanOrEqual(0.4)
    expect(c.limitedBy).toContain('dispute')
  })

  it('caps unvalidated knowledge below certainty', () => {
    const c = computeConfidence({ evidence: 1, reasoning: 1, policy: 1, freshness: 1, humanValidation: 'unvalidated' })
    expect(c.overall).toBeLessThanOrEqual(0.85)
  })

  it('reports no material weakness when every dimension is strong', () => {
    const c = computeConfidence({ evidence: 0.95, reasoning: 0.95, policy: 0.95, freshness: 0.95, humanValidation: 'validated' })
    expect(c.limitedBy).toContain('nothing material')
  })
})

// ===========================================================================
// 2. MEMORY AGES — and not all knowledge ages the same way
// ===========================================================================
describe('Knowledge lifecycle / aging', () => {
  const now = new Date('2026-07-16')

  it('never stales an event — history does not expire', () => {
    const e = node({ id: 'E1', kind: 'event', at: '2025-11-01' })
    expect(ageNode(e, now)).toBe('active')
    expect(freshnessOf(e, now)).toBe(1)
  })

  it('stales a project record past its short verification window', () => {
    const p = node({ id: 'P1', kind: 'project', at: '2026-01-01' })
    expect(ageNode(p, now)).toBe('stale')
  })

  it('stales strategic context past a quarter', () => {
    const s = node({ id: 'S1', kind: 'strategic', at: '2026-01-01' })
    expect(ageNode(s, now)).toBe('stale')
  })

  it('honours explicit expiry (validUntil) as obsolete', () => {
    const s = node({ id: 'S2', kind: 'strategic', at: '2026-07-01', validUntil: '2026-07-10' })
    expect(ageNode(s, now)).toBe('obsolete')
  })

  it('re-verification resets staleness', () => {
    const p = node({ id: 'P2', kind: 'project', at: '2026-01-01', lastVerifiedAt: '2026-07-15' })
    expect(ageNode(p, now)).toBe('active')
  })

  it('degrades the freshness dimension of confidence as it ages', () => {
    const p = node({ id: 'P3', kind: 'project', at: '2026-05-01' })
    const before = p.confidence.freshness
    refreshNode(p, now)
    expect(p.confidence.freshness).toBeLessThan(before)
  })

  it('supersession retires the old record explicitly, in both directions', () => {
    const oldN = node({ id: 'O1', kind: 'strategic' })
    const newN = node({ id: 'N1', kind: 'strategic' })
    supersede(oldN, newN)
    expect(oldN.lifecycle).toBe('superseded')
    expect(oldN.supersededBy).toBe('N1')
    expect(newN.supersedes).toBe('O1')
  })
})

// ===========================================================================
// 3. TEMPORAL DECISIONS — assumptions break, validity degrades
// ===========================================================================
describe('Decision validity is derived from assumptions', () => {
  let f: MemoryFabric
  beforeEach(() => { f = seedMemory() })

  it('D-193 holds while its assumptions hold', () => {
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    expect(validityOf(d).state).toBe('holds')
  })

  it('breaking one assumption puts the decision AT RISK', () => {
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    breakAssumption(d, 'A3', 'EV-999')
    const v = validityOf(d)
    expect(v.state).toBe('at_risk')
    expect(v.brokenAssumptions[0]).toContain('XYZ will not accept')
  })

  it('breaking two assumptions makes it INVALID', () => {
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    breakAssumption(d, 'A2', 'EV-998')
    breakAssumption(d, 'A3', 'EV-999')
    expect(validityOf(d).state).toBe('invalid')
  })

  it('attributes WHO/WHAT broke the assumption — never silently', () => {
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    breakAssumption(d, 'A3', 'EV-777')
    expect(d.assumptions.find((a) => a.id === 'A3')!.brokenBy).toBe('EV-777')
  })

  it('recall surfaces degraded validity unprompted', () => {
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    breakAssumption(d, 'A3', 'EV-777')
    const a = recall(f, 'why did we reject XYZ Bank?', OPEN_ACCESS)
    expect(a.validity?.state).toBe('at_risk')
    expect(a.answer).toMatch(/validity: AT_RISK/i)
  })

  it('recall reports unverified assumptions as a gap', () => {
    const a = recall(f, 'why did we reject XYZ Bank?', OPEN_ACCESS)
    expect(a.gaps.some((g) => /never verified/i.test(g))).toBe(true)
  })
})

// ===========================================================================
// 4. DECISION LINEAGE — why a recommendation exists; invalidation propagation
// ===========================================================================
describe('Decision lineage', () => {
  let f: MemoryFabric
  beforeEach(() => { f = seedMemory() })

  it('walks the full ancestry: Roadmap → Arch Review → Capacity → Budget', () => {
    const chain = ancestry(f, 'ST-27', OPEN_ACCESS)
    const ids = chain.map((c) => c.id)
    expect(ids).toContain('AR-118')
    expect(ids).toContain('D-140')
    expect(ids).toContain('D-100')
  })

  it('finds what rests on a foundation (blast radius)', () => {
    const kids = descendants(f, 'D-100', OPEN_ACCESS).map((d) => d.id)
    expect(kids).toContain('D-140')
    expect(kids).toContain('ST-27')
  })

  it('THE POINT: superseding a foundation flags everything resting on it', () => {
    expect(invalidationRisks(f, OPEN_ACCESS)).toHaveLength(0)
    const newBudget = node({ id: 'D-101', kind: 'decision', title: 'FY27 budget revision' })
    f.add(newBudget)
    supersede(f.get('D-100', OPEN_ACCESS)!, newBudget)

    const risks = invalidationRisks(f, OPEN_ACCESS)
    expect(risks.length).toBeGreaterThan(0)
    const affected = risks.map((r) => r.node.id)
    expect(affected).toContain('D-140') // directly on it
    expect(affected).toContain('ST-27') // transitively — the real value
    expect(risks.find((r) => r.node.id === 'D-140')!.severity).toBe('invalid')
    expect(risks.find((r) => r.node.id === 'ST-27')!.severity).toBe('at_risk')
  })

  it('explains lineage in a sentence an executive can read', () => {
    expect(explainLineage(f, 'ST-27', OPEN_ACCESS)).toContain('rests on')
  })

  it('recall attaches lineage to a decision', () => {
    const a = recall(f, 'why did we decide the capacity target?', OPEN_ACCESS)
    expect(a.lineage?.length ?? 0).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 5. ORGANIZATIONAL WISDOM — pattern → 3x → candidate → HUMAN → wisdom
// ===========================================================================
describe('Wisdom pipeline', () => {
  let f: MemoryFabric
  let engine: WisdomEngine
  beforeEach(() => {
    f = seedMemory()
    engine = new WisdomEngine()
  })

  const incident = (id: string, at: string) => node({
    id, kind: 'event', at, title: `Settlement incident ${id}`,
    tags: ['incident', 'settlement', 'npci'],
  })

  it('does NOT propose wisdom from a coincidence (< 3 occurrences)', () => {
    f.add(incident('X1', '2026-01-01'))
    f.add(incident('X2', '2026-02-01'))
    expect(engine.propose(f)).toHaveLength(0)
  })

  it('proposes candidate wisdom once a pattern repeats 3 times', () => {
    f.add(incident('X1', '2026-01-01'))
    f.add(incident('X2', '2026-02-01'))
    f.add(incident('X3', '2026-03-01'))
    const proposed = engine.propose(f)
    expect(proposed.length).toBeGreaterThan(0)
    expect(proposed[0].occurrenceCount).toBeGreaterThanOrEqual(3)
  })

  it('a candidate is NOT yet wisdom — it awaits a human', () => {
    f.add(incident('X1', '2026-01-01')); f.add(incident('X2', '2026-02-01')); f.add(incident('X3', '2026-03-01'))
    const c = engine.propose(f)[0]
    expect(c.status).toBe('candidate')
    // It must not be steering recommendations yet.
    expect(f.lessonsFor(['settlement'], OPEN_ACCESS)).toHaveLength(0)
  })

  it('a human approval promotes it to wisdom — attributed', () => {
    f.add(incident('X1', '2026-01-01')); f.add(incident('X2', '2026-02-01')); f.add(incident('X3', '2026-03-01'))
    const c = engine.propose(f)[0]
    const lesson = engine.approve(f, c.id, 'Deputy Chief', 'Treat settlement incidents as systemic; escalate on the 2nd in a quarter.')
    expect('error' in lesson).toBe(false)
    if ('error' in lesson) return
    expect(lesson.approvedBy).toBe('Deputy Chief')
    expect(lesson.confidence.humanValidation).toBe('validated')
    // NOW it steers recommendations.
    expect(f.lessonsFor(['settlement'], OPEN_ACCESS).length).toBeGreaterThan(0)
  })

  it('rejects double-approval', () => {
    f.add(incident('X1', '2026-01-01')); f.add(incident('X2', '2026-02-01')); f.add(incident('X3', '2026-03-01'))
    const c = engine.propose(f)[0]
    engine.approve(f, c.id, 'Deputy Chief')
    const second = engine.approve(f, c.id, 'Deputy Chief')
    expect('error' in second).toBe(true)
  })

  it('a rejected candidate never becomes wisdom', () => {
    f.add(incident('X1', '2026-01-01')); f.add(incident('X2', '2026-02-01')); f.add(incident('X3', '2026-03-01'))
    const c = engine.propose(f)[0]
    expect(engine.reject(c.id, 'Deputy Chief')).toBe(true)
    expect('error' in engine.approve(f, c.id, 'Deputy Chief')).toBe(true)
  })

  it('is idempotent — re-proposing updates, never duplicates', () => {
    f.add(incident('X1', '2026-01-01')); f.add(incident('X2', '2026-02-01')); f.add(incident('X3', '2026-03-01'))
    engine.propose(f)
    const before = engine.list().length
    engine.propose(f)
    expect(engine.list().length).toBe(before)
  })

  it('"resembles L-1 from the Diwali outage" — recognises live situations', () => {
    const live = node({ id: 'LIVE', kind: 'event', tags: ['upi', 'deploy', 'release', 'festival'] })
    const matches = resembles(f, live, OPEN_ACCESS)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].lesson.id).toBe('L-1')
    expect(matches[0].overlap.length).toBeGreaterThanOrEqual(2)
  })

  it('one shared tag is a coincidence, not a resemblance', () => {
    const live = node({ id: 'LIVE2', kind: 'event', tags: ['upi'] })
    expect(resembles(f, live, OPEN_ACCESS)).toHaveLength(0)
  })
})

// ===========================================================================
// 6. ORG vs EXECUTIVE MEMORY — facts and judgment are different things
// ===========================================================================
describe('Organizational memory ≠ Executive memory', () => {
  const f = seedMemory()

  it('separates the layers', () => {
    const s = f.stats()
    expect(s.byLayer.organizational).toBeGreaterThan(0)
    expect(s.byLayer.executive).toBeGreaterThan(0)
  })

  it("surfaces the executive's judgment, with the experience behind it", () => {
    const js = f.judgmentsFor(['vendor', 'sla', 'migration'], OPEN_ACCESS)
    expect(js.length).toBeGreaterThan(0)
    expect(js[0].judgment).toMatch(/keep the vendor/i)
    expect(js[0].because).toMatch(/transition failed|2025/i)
    expect(js[0].heldBy).toBe('Deputy Chief')
  })

  it('recall returns judgment alongside org facts', () => {
    const a = recall(f, 'what happened with the AxisPay vendor SLA?', OPEN_ACCESS)
    expect(a.judgments.length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 7. KNOWLEDGE QUALITY — the system assessing its own reliability
// ===========================================================================
describe('Knowledge quality scoring', () => {
  it('scores a clean seeded fabric and names no material weakness', () => {
    const q = knowledgeQuality(seedMemory(), OPEN_ACCESS)
    expect(q.overall).toBeGreaterThan(50)
    expect(q.totals.records).toBeGreaterThan(15)
  })

  it('penalises and NAMES disputed knowledge', () => {
    const f = seedMemory()
    const d = f.get('D-193', OPEN_ACCESS)!
    d.confidence = computeConfidence({ ...d.confidence, humanValidation: 'disputed' })
    const q = knowledgeQuality(f, OPEN_ACCESS)
    expect(q.totals.disputed).toBeGreaterThan(0)
    expect(q.recommendations.join(' ')).toMatch(/contradiction/i)
  })

  it('counts conclusions resting on moved foundations', () => {
    const f = seedMemory()
    const n = node({ id: 'D-101', kind: 'decision' })
    f.add(n)
    supersede(f.get('D-100', OPEN_ACCESS)!, n)
    const q = knowledgeQuality(f, OPEN_ACCESS)
    expect(q.totals.restingOnMovedFoundations).toBeGreaterThan(0)
  })

  it('reports quality per kind so weak areas are locatable', () => {
    const q = knowledgeQuality(seedMemory(), OPEN_ACCESS)
    expect(q.byKind.decision.count).toBeGreaterThan(0)
    expect(q.byKind.decision.avgConfidence).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 8. KNOWLEDGE EVOLUTION — living, not records
// ===========================================================================
describe('Knowledge Evolution (continuous)', () => {
  let f: MemoryFabric
  let ke: KnowledgeEvolution
  beforeEach(() => { f = seedMemory(); ke = new KnowledgeEvolution(f) })

  it('AUTOMATICALLY CAPTURES a material observation as institutional memory', () => {
    const before = f.all(OPEN_ACCESS).length
    ke.onEvent(makeEvent('azure-monitor', 'channel.metric', 'upi', { successRate: 84.5, status: 'critical' }))
    expect(f.all(OPEN_ACCESS).length).toBe(before + 1)
  })

  it('ignores non-material noise — memory, not a log', () => {
    const before = f.all(OPEN_ACCESS).length
    ke.onEvent(makeEvent('azure-monitor', 'channel.metric', 'upi', { successRate: 99.8, status: 'healthy' }))
    expect(f.all(OPEN_ACCESS).length).toBe(before)
  })

  it('does not re-record the same condition every heartbeat', () => {
    const e = () => makeEvent('azure-monitor', 'channel.metric', 'upi', { successRate: 84.5, status: 'critical' })
    ke.onEvent(e())
    const after1 = f.all(OPEN_ACCESS).length
    ke.onEvent(e())
    expect(f.all(OPEN_ACCESS).length).toBe(after1)
  })

  it('marks auto-captured knowledge unvalidated — nobody confirmed it', () => {
    const r = ke.onEvent(makeEvent('azure-monitor', 'channel.metric', 'upi', { successRate: 84.5, status: 'critical' }))
    const captured = f.get(r.captured[0], OPEN_ACCESS)!
    expect(captured.confidence.humanValidation).toBe('unvalidated')
  })

  it('rates synthetic-sourced evidence lower than a real system', () => {
    const ke2 = new KnowledgeEvolution(seedMemory())
    const syn = ke2.onEvent(makeEvent('synthetic', 'channel.metric', 'upi', { successRate: 84.5, status: 'critical' }))
    const real = ke.onEvent(makeEvent('azure-monitor', 'channel.metric', 'upi', { successRate: 84.5, status: 'critical' }))
    const synNode = ke2['fabric'].get(syn.captured[0], OPEN_ACCESS)!
    const realNode = f.get(real.captured[0], OPEN_ACCESS)!
    expect(synNode.confidence.evidence).toBeLessThan(realNode.confidence.evidence)
  })

  it('DETECTS CONFLICT and marks both records disputed pending human resolution', () => {
    const a = node({ id: 'C1', kind: 'strategic', title: 'NPCI circular published' })
    const b = node({ id: 'C2', kind: 'strategic', title: 'NPCI circular not published' })
    f.add(a); f.add(b)
    f.link({ from: 'C1', to: 'C2', relation: 'contradicts', provenance: a.provenance })
    const r = ke.onEvent(makeEvent('webhook', 'project.risk', 'PRJ-A', { riskScore: 50 }))
    expect(r.conflicts.length).toBeGreaterThan(0)
    expect(f.get('C1', OPEN_ACCESS)!.confidence.humanValidation).toBe('disputed')
    expect(f.get('C2', OPEN_ACCESS)!.confidence.overall).toBeLessThanOrEqual(0.4)
  })

  it('SUPERSEDES old knowledge rather than letting it coexist', () => {
    const newer = node({ id: 'ST-03', kind: 'strategic', title: 'NPCI circular PUBLISHED (July 2026)' })
    f.add(newer)
    f.link({ from: 'ST-03', to: 'ST-02', relation: 'supersedes', provenance: newer.provenance })
    const r = ke.onEvent(makeEvent('webhook', 'project.risk', 'PRJ-A', { riskScore: 50 }))
    expect(r.superseded).toContainEqual({ oldId: 'ST-02', newId: 'ST-03' })
    expect(f.get('ST-02', OPEN_ACCESS)!.lifecycle).toBe('superseded')
  })

  it('BREAKS AN ASSUMPTION when a record invalidates it, and degrades the decision', () => {
    const evidence = node({ id: 'EV-NPCI', kind: 'event', title: 'NPCI confirmed circular deferred to 2027' })
    f.add(evidence)
    f.link({
      from: 'EV-NPCI', to: 'D-193', relation: 'invalidates',
      provenance: { source: 'assumption:A1', recordedAt: '2026-07-16', recordedBy: 'Compliance', confidence: 'stated' },
    })
    const r = ke.onEvent(makeEvent('webhook', 'project.risk', 'PRJ-A', { riskScore: 50 }))
    expect(r.assumptionsBroken.length).toBe(1)
    expect(r.assumptionsBroken[0].decisionId).toBe('D-193')
    const d = f.get('D-193', OPEN_ACCESS) as DecisionMemory
    expect(validityOf(d).state).toBe('at_risk')
    expect(d.assumptions.find((a) => a.id === 'A1')!.brokenBy).toBe('EV-NPCI')
  })

  it('ages knowledge on the heartbeat — with nobody querying', () => {
    const stale = node({ id: 'OLD', kind: 'project', at: '2025-01-01' })
    f.add(stale)
    const r = ke.tick(new Date('2026-07-16'))
    expect(r.aged).toBeGreaterThan(0)
    expect(f.get('OLD', OPEN_ACCESS)!.lifecycle).toBe('stale')
  })

  it('reports its own quality on every tick', () => {
    const r = ke.tick(new Date('2026-07-16'))
    expect(r.quality).toBeGreaterThanOrEqual(0)
    expect(r.quality).toBeLessThanOrEqual(100)
  })
})

// ===========================================================================
// 9. The fabric refuses to store bare records
// ===========================================================================
describe('The fabric stores knowledge, not records', () => {
  it('normalizes a node without lifecycle semantics on write', () => {
    const f = new MemoryFabric()
    // Deliberately bare — as a naive caller would write it.
    f.add({ id: 'BARE', kind: 'event', title: 't', at: '2026-01-01', summary: '', tags: [], sensitivity: 'open',
      provenance: { source: 's', recordedAt: '2026-01-01', recordedBy: 'r', confidence: 'stated' } } as never)
    const n = f.get('BARE', OPEN_ACCESS)!
    expect(n.layer).toBe('organizational')
    expect(n.lifecycle).toBe('active')
    expect(n.confidence.overall).toBeGreaterThan(0)
  })

  it('classifies a judgment into the executive layer automatically', () => {
    const f = new MemoryFabric()
    f.add({ id: 'J', kind: 'judgment', title: 't', at: '2026-01-01', summary: '', tags: [], sensitivity: 'open',
      provenance: { source: 's', recordedAt: '2026-01-01', recordedBy: 'r', confidence: 'stated' } } as never)
    expect(f.get('J', OPEN_ACCESS)!.layer).toBe('executive')
  })

  it('never lets superseded wisdom steer a live recommendation', () => {
    const f = seedMemory()
    const l1 = f.get('L-1', OPEN_ACCESS)!
    expect(f.lessonsFor(['festival', 'deploy'], OPEN_ACCESS).length).toBeGreaterThan(0)
    l1.lifecycle = 'superseded'
    expect(f.lessonsFor(['festival', 'deploy'], OPEN_ACCESS)).toHaveLength(0)
  })
})
