import { describe, it, expect } from 'vitest'
import { seedTwin } from '../twin/state.js'
import { OFFICES } from '../twin/offices.js'
import { optimizeAttention } from '../twin/attention.js'
import { pulse } from '../twin/pulse.js'
import type { Observation } from '../twin/model.js'

describe('AI Offices observe and predict continuously', () => {
  it('Delivery Office predicts PRJ-A (72% vs 82% plan) will miss its deadline', () => {
    const state = seedTwin()
    const delivery = OFFICES.find((o) => o.id === 'delivery')!
    const r = delivery.run(state)
    expect(r.predictions.some((p) => p.title.includes('UPI Autoscale') && /miss/i.test(p.title))).toBe(true)
  })

  it('Risk Office flags AxisPay SLA decline (3 breaches)', () => {
    const state = seedTwin()
    const risk = OFFICES.find((o) => o.id === 'risk')!
    const r = risk.run(state)
    expect(r.observations.some((o) => o.title.includes('AxisPay') && /SLA/i.test(o.title))).toBe(true)
  })

  it('Customer Office surfaces the +34% merchant complaints spike', () => {
    const state = seedTwin()
    const customer = OFFICES.find((o) => o.id === 'customer')!
    const r = customer.run(state)
    expect(r.observations.some((o) => o.title.includes('+34%'))).toBe(true)
  })

  it('Strategy Office notices the RBI circular needs a roadmap change', () => {
    const state = seedTwin()
    const strategy = OFFICES.find((o) => o.id === 'strategy')!
    const r = strategy.run(state)
    expect(r.observations.some((o) => /roadmap change/i.test(o.title))).toBe(true)
  })
})

describe('Executive Attention Engine', () => {
  const obs = (over: Partial<Observation>): Observation => ({
    id: 'x', office: 'operations', severity: 'concern', title: 't', detail: 'd',
    materiality: 0.5, urgency: 0.5, ...over,
  })

  it('caps executive attention at 3 and delegates/handles the rest', () => {
    const items = [
      obs({ id: 'a', materiality: 0.9, urgency: 0.9 }),
      obs({ id: 'b', materiality: 0.9, urgency: 0.8 }),
      obs({ id: 'c', materiality: 0.8, urgency: 0.8 }),
      obs({ id: 'd', materiality: 0.8, urgency: 0.7 }),
      obs({ id: 'e', materiality: 0.3, urgency: 0.3 }),
      obs({ id: 'f', materiality: 0.1, urgency: 0.1 }),
    ]
    const r = optimizeAttention(items)
    expect(r.forExecutive.length).toBe(3)
    expect(r.delegated.length).toBeGreaterThanOrEqual(1)
    expect(r.handledCount).toBeGreaterThanOrEqual(1)
    // highest score first
    expect(r.forExecutive[0].id).toBe('a')
  })

  it('reclaims executive time proportional to delegated + handled load', () => {
    const items = Array.from({ length: 10 }, (_, i) => obs({ id: `n${i}`, materiality: 0.1, urgency: 0.1 }))
    const r = optimizeAttention(items)
    expect(r.hoursReclaimed).toBeGreaterThan(0)
  })
})

describe('Pulse heartbeat', () => {
  it('produces a snapshot with 8 offices and an org health score', () => {
    const snap = pulse.beat(false)
    expect(snap.offices.length).toBe(8)
    expect(snap.organizationHealth).toBeGreaterThan(0)
    expect(snap.organizationHealth).toBeLessThanOrEqual(100)
  })

  it('advances the tick when it perceives', () => {
    const before = pulse.beat(false).tick
    const after = pulse.beat(true).tick
    expect(after).toBe(before + 1)
  })

  it('reports honestly that no REAL enterprise source is connected in this POC', () => {
    const snap = pulse.beat(false)
    expect(snap.perception.liveSources).toBe(0)
    const synthetic = snap.perception.connectors.find((c) => c.id === 'synthetic')
    expect(synthetic?.status).toBe('live')
    // The four enterprise connectors are wired but must not claim to be live.
    for (const id of ['ms-graph', 'azure-devops', 'servicenow', 'azure-monitor']) {
      expect(snap.perception.connectors.find((c) => c.id === id)?.status).toBe('not-configured')
    }
  })
})

describe('Operations Office scores on severity, not raw rate', () => {
  it('treats a critical payment channel as critical even at 84.5%', () => {
    const state = seedTwin()
    const upi = state.channels.find((c) => c.id === 'upi')!
    upi.successRate = 84.5
    upi.status = 'critical'
    const ops = OFFICES.find((o) => o.id === 'operations')!
    const r = ops.run(state)
    expect(r.health.band).toBe('critical')
    expect(r.observations[0].urgency).toBe(1)
  })
})
