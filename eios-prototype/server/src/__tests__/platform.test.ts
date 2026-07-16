import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, mkdtempSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventStore } from '../platform/eventStore.js'
import { replay, asOf, stateHash, verifyDeterminism, replayAgainstHistory } from '../platform/replay.js'
import { architectureScorecard } from '../platform/metrics.js'
import { feedback } from '../platform/feedback.js'
import { makeEvent } from '../perception/events.js'
import { seedMemory } from '../memory/seed.js'
import { seedTwin } from '../twin/state.js'
import type { TwinState } from '../twin/model.js'

const ev = (entityId: string, completion: number, at?: string) => {
  const e = makeEvent('azure-devops', 'project.progress', entityId, { completion })
  if (at) e.at = at
  return e
}

// ===========================================================================
// THE EVENT STORE — the log is the system of record
// ===========================================================================
describe('Event Store', () => {
  it('assigns monotonic sequence numbers — ordering is the truth', () => {
    const s = new EventStore()
    const a = s.append(ev('PRJ-A', 75))
    const b = s.append(ev('PRJ-A', 76))
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
    expect(s.count()).toBe(2)
  })

  it('is append-only — history is never mutated, only extended', () => {
    const s = new EventStore()
    s.append(ev('PRJ-A', 75))
    const before = s.digest()
    s.append(ev('PRJ-A', 76))
    expect(s.digest()).not.toBe(before) // new history
    // The first event is still exactly as recorded.
    expect(s.read({ from: 1, to: 1 })[0].data.completion).toBe(75)
  })

  it('reads ranges and time-bounded slices', () => {
    const s = new EventStore()
    s.append(ev('PRJ-A', 10, '2026-01-01T00:00:00Z'))
    s.append(ev('PRJ-A', 20, '2026-03-14T00:00:00Z'))
    s.append(ev('PRJ-A', 30, '2026-07-01T00:00:00Z'))
    expect(s.read({ until: '2026-03-14T00:00:00Z' })).toHaveLength(2)
    expect(s.read({ from: 2 })).toHaveLength(2)
  })

  it('two stores with identical history share a digest', () => {
    const a = new EventStore(); const b = new EventStore()
    for (const s of [a, b]) { s.append(ev('PRJ-A', 75)); s.append(ev('PRJ-B', 40)) }
    expect(a.digest()).toBe(b.digest())
  })
})

// ===========================================================================
// DURABILITY — the gap that made "v1" undeserved
// ===========================================================================
describe('Event Store durability', () => {
  let dir: string
  let path: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'eios-')); path = join(dir, 'events.jsonl') })
  afterEach(() => { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) })

  it('SURVIVES RESTART — a new store reads back the history', () => {
    const s1 = new EventStore({ path })
    s1.append(ev('PRJ-A', 91))
    s1.append(ev('PRJ-B', 55))

    // Simulate a process restart: brand-new store, same file.
    const s2 = new EventStore({ path })
    expect(s2.count()).toBe(2)
    expect(s2.digest()).toBe(s1.digest())
  })

  it('rebuilds identical organizational state after restart', () => {
    const s1 = new EventStore({ path })
    s1.append(ev('PRJ-A', 91))
    const hashBefore = replay(s1).hash

    const s2 = new EventStore({ path })
    expect(replay(s2).hash).toBe(hashBefore)
  })

  it('truncates at a corrupt tail rather than poisoning the whole log', () => {
    const s1 = new EventStore({ path })
    s1.append(ev('PRJ-A', 91))
    s1.append(ev('PRJ-B', 55))
    appendFileSync(path, '{ this is not json\n', 'utf8')

    const s2 = new EventStore({ path })
    // The two good events survive; the torn write does not take the log down.
    expect(s2.count()).toBe(2)
  })

  it('snapshots and resumes from them', () => {
    const s = new EventStore({ path, snapshotPath: join(dir, 'snap.json') })
    s.append(ev('PRJ-A', 91))
    const twin = replay(s).twin
    s.saveSnapshot(twin)

    const loaded = s.loadSnapshot<TwinState>()
    expect(loaded?.seq).toBe(1)
    expect(stateHash(loaded!.state)).toBe(stateHash(twin))
  })
})

// ===========================================================================
// REPLAY DETERMINISM — the architecture-level acceptance test
// ===========================================================================
describe('Replay determinism', () => {
  it('THE PROPERTY: same history ⇒ byte-identical organization', () => {
    const s = new EventStore()
    for (let i = 0; i < 40; i++) s.append(ev(i % 2 ? 'PRJ-A' : 'PRJ-B', 50 + i * 0.5))
    const r = verifyDeterminism(s)
    expect(r.deterministic).toBe(true)
    expect(r.hashA).toBe(r.hashB)
    expect(r.detail).toMatch(/identical state/)
  })

  it('the hash ignores wall-clock/runtime metadata, not domain state', () => {
    const a = seedTwin()
    const b = seedTwin()
    b.tick = 999
    b.lastTickAt = new Date(Date.now() + 1e6).toISOString()
    // Different process metadata, same organization → same hash.
    expect(stateHash(a)).toBe(stateHash(b))

    b.projects[0].completion = 1
    // Different organization → different hash.
    expect(stateHash(a)).not.toBe(stateHash(b))
  })

  it('the hash is insensitive to float noise but not to real change', () => {
    const a = seedTwin(); const b = seedTwin()
    b.projects[0].completion = a.projects[0].completion + 1e-9
    expect(stateHash(a)).toBe(stateHash(b))
    b.projects[0].completion = a.projects[0].completion + 0.01
    expect(stateHash(a)).not.toBe(stateHash(b))
  })

  it('replay counts rejected events rather than silently dropping them', () => {
    const s = new EventStore()
    s.append(ev('PRJ-A', 75))
    s.append(ev('GHOST-PRJ', 75))
    const r = replay(s)
    expect(r.eventsApplied).toBe(1)
    expect(r.eventsRejected).toBe(1)
  })

  it('reports unmeasurable on an empty log instead of claiming success', () => {
    const s = new EventStore()
    const card = architectureScorecard({ store: s, memory: seedMemory(), decisions: [], twinFreshnessSamples: [] })
    const det = card.metrics.find((m) => m.id === 'replay_determinism')!
    expect(det.measurable).toBe(false)
    expect(det.value).toBeNull()
  })
})

// ===========================================================================
// TIME TRAVEL — "show me the organization on 14 March 2026"
// ===========================================================================
describe('Time travel', () => {
  const build = () => {
    const s = new EventStore()
    s.append(ev('PRJ-A', 20, '2026-01-10T00:00:00Z'))
    s.append(ev('PRJ-A', 50, '2026-03-14T00:00:00Z'))
    s.append(ev('PRJ-A', 90, '2026-07-01T00:00:00Z'))
    return s
  }

  it('reconstructs the organization as it existed at a past instant', () => {
    const s = build()
    expect(asOf(s, '2026-01-10T00:00:00Z').twin.projects.find((p) => p.id === 'PRJ-A')!.completion).toBe(20)
    expect(asOf(s, '2026-03-14T00:00:00Z').twin.projects.find((p) => p.id === 'PRJ-A')!.completion).toBe(50)
    expect(asOf(s, '2026-07-01T00:00:00Z').twin.projects.find((p) => p.id === 'PRJ-A')!.completion).toBe(90)
  })

  it('a past reconstruction is stable — the past does not change', () => {
    const s = build()
    const a = asOf(s, '2026-03-14T00:00:00Z').hash
    s.append(ev('PRJ-A', 95, '2026-07-16T00:00:00Z')) // new history after that date
    expect(asOf(s, '2026-03-14T00:00:00Z').hash).toBe(a)
  })

  it('travelling before any history yields the seed organization', () => {
    expect(asOf(build(), '2020-01-01T00:00:00Z').eventsApplied).toBe(0)
  })

  it('KNOWLEDGE REPLAY: runs todays reasoning against a past organization', () => {
    const s = build()
    const { result, at } = replayAgainstHistory(s, '2026-01-10T00:00:00Z', (twin) => {
      const p = twin.projects.find((x) => x.id === 'PRJ-A')!
      return { wouldFlag: p.completion < p.plannedCompletion - 5, completion: p.completion }
    })
    expect(at).toBe('2026-01-10T00:00:00Z')
    expect(result.completion).toBe(20)
    // Today's rule would have flagged this project back then — the basis for
    // validating new reasoning against history rather than opinion.
    expect(result.wouldFlag).toBe(true)
  })
})

// ===========================================================================
// ARCHITECTURE SCORECARD — success is not test count
// ===========================================================================
describe('Architecture scorecard', () => {
  beforeEach(() => feedback.reset())

  const card = (over: Partial<Parameters<typeof architectureScorecard>[0]> = {}) => {
    const s = new EventStore()
    s.append(ev('PRJ-A', 75))
    return architectureScorecard({
      store: s, memory: seedMemory(), decisions: [], twinFreshnessSamples: [], ...over,
    })
  }

  it('reports metrics it cannot honestly compute as unmeasurable — not as a default', () => {
    const c = card()
    const precision = c.metrics.find((m) => m.id === 'attention_precision')!
    expect(precision.measurable).toBe(false)
    expect(precision.value).toBeNull()
    expect(precision.detail).toMatch(/feedback/i)
  })

  it('never claims to self-measure missed critical events', () => {
    const m = card().metrics.find((x) => x.id === 'missed_critical')!
    expect(m.measurable).toBe(false)
    expect(m.detail).toMatch(/NOT self-measurable/i)
  })

  it('refuses to compute a rate from fewer than 3 samples', () => {
    feedback.recordAttention({ itemId: 'a', office: 'ops', title: 't', neededExecutive: true, by: 'DC' })
    feedback.recordAttention({ itemId: 'b', office: 'ops', title: 't', neededExecutive: true, by: 'DC' })
    const m = card().metrics.find((x) => x.id === 'attention_precision')!
    expect(m.measurable).toBe(false)
    expect(m.detail).toMatch(/noise, not a metric/i)
  })

  it('computes attention precision and false escalation once feedback exists', () => {
    feedback.recordAttention({ itemId: 'a', office: 'ops', title: 't', neededExecutive: true, by: 'DC' })
    feedback.recordAttention({ itemId: 'b', office: 'ops', title: 't', neededExecutive: true, by: 'DC' })
    feedback.recordAttention({ itemId: 'c', office: 'ops', title: 't', neededExecutive: false, by: 'DC' })
    const c = card()
    expect(c.metrics.find((m) => m.id === 'attention_precision')!.value).toBe(67)
    expect(c.metrics.find((m) => m.id === 'false_escalation')!.value).toBe(33)
  })

  it('measures twin freshness as p95 latency, not an average', () => {
    const m = card({ twinFreshnessSamples: [10, 12, 11, 900] }).metrics.find((x) => x.id === 'twin_freshness')!
    expect(m.measurable).toBe(true)
    expect(m.value).toBe(900) // the tail is the story, not the mean
  })

  it('measures knowledge integrity against provenance AND validity', () => {
    const m = card().metrics.find((x) => x.id === 'knowledge_integrity')!
    expect(m.measurable).toBe(true)
    expect(m.value).toBeGreaterThan(0)
    expect(m.value).toBeLessThan(100) // an honest fabric is never 100% pristine
  })

  it('summarises how much of its own scorecard it can honestly fill in', () => {
    const c = card()
    expect(c.notMeasurable).toBeGreaterThan(0)
    expect(c.summary).toMatch(/unmeasurable rather than estimated/)
  })
})
