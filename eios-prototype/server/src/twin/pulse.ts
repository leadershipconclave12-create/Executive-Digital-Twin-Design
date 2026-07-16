import type { TwinState, PulseSnapshot, OfficeHealth, Prediction } from './model.js'
import { OFFICES } from './offices.js'
import { optimizeAttention } from './attention.js'
import { bus } from '../events/bus.js'
import { perception } from '../perception/index.js'
import { knowledgeEvolution } from '../knowledge/index.js'

// The Pulse — EIOS's heartbeat. On every tick it evolves the twin, runs all
// Offices, optimizes the executive's attention, and publishes a fresh snapshot.
// This loop runs whether or not anyone is looking; the executive interrogates a
// system that has already done the work.

type Listener = (snapshot: PulseSnapshot) => void

class Pulse {
  private latest: PulseSnapshot | null = null
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()
  private raised = new Set<string>()

  /** The twin is owned by the Perception Layer; the Pulse only reads it. */
  private get state(): TwinState { return perception.twin() }

  /**
   * One heartbeat: perceive (connectors → events → twin), then run the Offices
   * over the resulting state and optimize the executive's attention.
   */
  beat(perceive = true): PulseSnapshot {
    if (perceive) {
      const observed = perception.perceive()
      perception.markTick()
      // Knowledge is LIVING: every observation may become an institutional record, break
      // an assumption, contradict what we believed, or propose candidate wisdom. And
      // knowledge ages on the heartbeat whether or not anyone queries it.
      for (const e of observed.events) knowledgeEvolution.onEvent(e)
      knowledgeEvolution.tick()
    }

    const offices: OfficeHealth[] = []
    const allObs = []
    const predictions: Prediction[] = []
    for (const office of OFFICES) {
      const r = office.run(this.state)
      offices.push(r.health)
      allObs.push(...r.observations)
      predictions.push(...r.predictions)
    }

    const attention = optimizeAttention(allObs)
    const organizationHealth = Math.round(offices.reduce((a, o) => a + o.score, 0) / offices.length)

    const p = perception.report()
    const snapshot: PulseSnapshot = {
      tick: this.state.tick,
      at: this.state.lastTickAt,
      offices,
      organizationHealth,
      attention,
      predictions,
      perception: {
        liveSources: p.liveSources,
        eventsApplied: p.applied,
        connectors: p.connectors,
        recentEvents: perception.recentEvents(8),
      },
    }
    this.latest = snapshot

    // Journal only NEW executive-grade attention — re-raising the same item every
    // heartbeat would flood the audit trail and teach the executive to ignore it.
    for (const item of attention.forExecutive) {
      const key = `${item.office}|${item.title}`
      if (this.raised.has(key)) continue
      this.raised.add(key)
      bus.publish('attention.raised', {
        actor: 'EIOS', actorRole: 'system', resource: item.office,
        detail: `${item.title} → ${item.recommendedAction}`,
      })
    }

    for (const l of this.listeners) l(snapshot)
    return snapshot
  }

  start(intervalMs = 4000): void {
    if (this.timer) return
    this.beat(false) // publish an initial snapshot immediately
    this.timer = setInterval(() => this.beat(true), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  snapshot(): PulseSnapshot {
    return this.latest ?? this.beat(false)
  }

  /** Read-only view of the Perception-owned twin. */
  twin(): TwinState {
    return perception.twin()
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

export const pulse = new Pulse()
