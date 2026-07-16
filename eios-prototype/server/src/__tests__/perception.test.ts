import { describe, it, expect } from 'vitest'
import { PerceptionLayer } from '../perception/index.js'
import { SyntheticConnector, MsGraphConnector, AzureDevOpsConnector } from '../perception/connectors.js'
import { makeEvent, validateEvent } from '../perception/events.js'
import { seedTwin } from '../twin/state.js'
import { applyEvent } from '../perception/reducer.js'

describe('twin is event-sourced (reducer)', () => {
  it('changes project completion only via an event', () => {
    const twin = seedTwin()
    const before = twin.projects[0].completion
    applyEvent(twin, makeEvent('webhook', 'project.progress', 'PRJ-A', { completion: 91 }))
    expect(twin.projects[0].completion).toBe(91)
    expect(before).not.toBe(91)
  })

  it('records a vendor SLA breach', () => {
    const twin = seedTwin()
    const before = twin.vendors[0].breachesThisQuarter
    applyEvent(twin, makeEvent('servicenow', 'vendor.sla', 'VEND-AXIS', { slaAttainment: 91.4, breach: true }))
    expect(twin.vendors[0].slaAttainment).toBeCloseTo(91.4)
    expect(twin.vendors[0].breachesThisQuarter).toBe(before + 1)
  })

  it('rejects events for unknown entities rather than inventing them', () => {
    const twin = seedTwin()
    const ok = applyEvent(twin, makeEvent('webhook', 'project.progress', 'PRJ-DOES-NOT-EXIST', { completion: 50 }))
    expect(ok).toBe(false)
  })

  it('clamps out-of-range values', () => {
    const twin = seedTwin()
    applyEvent(twin, makeEvent('webhook', 'project.progress', 'PRJ-A', { completion: 900 }))
    expect(twin.projects[0].completion).toBe(100)
  })
})

describe('event validation (ingestion boundary)', () => {
  it('rejects an unknown kind', () => {
    const r = validateEvent({ kind: 'nonsense', entityId: 'PRJ-A', data: {} })
    expect('error' in r).toBe(true)
  })
  it('rejects a missing entityId', () => {
    const r = validateEvent({ kind: 'project.risk', data: { riskScore: 10 } })
    expect('error' in r).toBe(true)
  })
  it('accepts a well-formed event and defaults the source to webhook', () => {
    const r = validateEvent({ kind: 'project.risk', entityId: 'PRJ-A', data: { riskScore: 10 } })
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.source).toBe('webhook')
  })
})

describe('connectors', () => {
  it('synthetic connector is live and emits normalized events', () => {
    const c = new SyntheticConnector()
    expect(c.isConfigured()).toBe(true)
    const events = c.poll(seedTwin())
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.source === 'synthetic')).toBe(true)
  })

  it('enterprise connectors report not-configured and emit NOTHING without credentials', () => {
    for (const c of [new MsGraphConnector(), new AzureDevOpsConnector()]) {
      expect(c.isConfigured()).toBe(false)
      expect(c.status()).toBe('not-configured')
      // Critical: they must not fabricate data — that would make the twin lie.
      expect(c.poll()).toEqual([])
    }
  })
})

describe('PerceptionLayer', () => {
  it('folds connector events into the twin and returns the batch for downstream learning', () => {
    const p = new PerceptionLayer([new SyntheticConnector()])
    const r = p.perceive()
    expect(r.events.length).toBeGreaterThan(0)
    expect(r.events.every((e) => e.source === 'synthetic')).toBe(true)
    expect(p.report().applied).toBeGreaterThan(0)
  })

  it('reports zero live REAL sources when only synthetic is connected', () => {
    const p = new PerceptionLayer([new SyntheticConnector(), new MsGraphConnector()])
    expect(p.report().liveSources).toBe(0)
  })

  it('ingests an external webhook event into the twin', () => {
    const p = new PerceptionLayer([])
    const ok = p.ingest(makeEvent('webhook', 'channel.metric', 'upi', { successRate: 88.2, status: 'critical' }))
    expect(ok).toBe(true)
    const upi = p.twin().channels.find((c) => c.id === 'upi')!
    expect(upi.successRate).toBeCloseTo(88.2)
    expect(upi.status).toBe('critical')
  })
})

describe('pushed events accrete knowledge, not just twin state', () => {
  it('an externally-pushed material event becomes institutional memory', async () => {
    const { memory } = await import('../memory/seed.js')
    const { KnowledgeEvolution } = await import('../knowledge/evolution.js')
    const { OPEN_ACCESS } = await import('../memory/fabric.js')
    const ke = new KnowledgeEvolution(memory)
    const before = memory.all(OPEN_ACCESS).length
    ke.onEvent(makeEvent('servicenow', 'vendor.sla', 'VEND-AXIS', { slaAttainment: 88.0, breach: true }))
    expect(memory.all(OPEN_ACCESS).length).toBe(before + 1)
  })
})
