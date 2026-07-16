import type { TwinState } from '../twin/model.js'
import { seedTwin } from '../twin/state.js'
import type { Connector, ConnectorStatus } from './connectors.js'
import { defaultConnectors } from './connectors.js'
import { applyEvent } from './reducer.js'
import type { OrgEvent, SourceSystem } from './events.js'
import { eventStore } from '../platform/index.js'
import { replay } from '../platform/replay.js'

// The Perception Layer (Program #1). It owns the Organizational Twin and is the
// ONLY component permitted to mutate it — and only ever by applying a normalized
// OrgEvent. Everything downstream (Offices, Attention, Pulse) reads the twin but
// cannot change it.
//
//   Connectors (Graph / DevOps / ServiceNow / Monitor / synthetic / webhook)
//        └─► OrgEvent ─► applyEvent(reducer) ─► Twin ─► Offices ─► Attention

export interface ConnectorReport {
  id: SourceSystem
  name: string
  observes: string
  status: ConnectorStatus
  eventsEmitted: number
}

export class PerceptionLayer {
  private state: TwinState = seedTwin()
  private connectors: Connector[]
  private recent: OrgEvent[] = []
  private counts = new Map<SourceSystem, number>()
  private applied = 0
  private rejected = 0
  /** Latency samples (event occurred → twin updated) for the twin-freshness metric. */
  private freshness: number[] = []
  /** When set, every ingested event is durably logged before it touches the twin. */
  private log = eventStore

  constructor(connectors: Connector[] = defaultConnectors()) {
    this.connectors = connectors
  }

  /**
   * PHASE 2: the twin is a materialized view over the log. On boot we rebuild the
   * organization from its recorded history rather than starting from a blank seed —
   * the system remembers what it observed before it was restarted.
   */
  rebuildFromLog(): { events: number; hash: string } {
    const snapshot = this.log.loadSnapshot<TwinState>()
    const r = replay(this.log, snapshot ? { snapshot } : {})
    this.state = r.twin
    this.applied = r.eventsApplied
    return { events: r.eventsApplied, hash: r.hash.slice(0, 12) }
  }

  /** Poll every connector and fold the resulting events into the twin. */
  perceive(): { events: OrgEvent[]; applied: number } {
    const batch: OrgEvent[] = []
    for (const c of this.connectors) {
      try {
        if (c.isConfigured()) batch.push(...c.poll(this.state))
      } catch {
        // A failing connector must never take down perception.
      }
    }
    for (const e of batch) this.ingest(e)
    // Return the batch so downstream (Knowledge Evolution) can learn from the same
    // observations without re-polling the connectors.
    return { events: batch, applied: this.applied }
  }

  /**
   * Apply a single normalized event. ORDER MATTERS: the event is appended to the
   * immutable log FIRST, then folded into the twin. The log is the system of record;
   * the twin is derived. Anything that reached the twin can therefore be replayed.
   */
  ingest(e: OrgEvent): boolean {
    // Reject before logging: the log records what the organization observed, not
    // malformed input aimed at entities that do not exist.
    const ok = applyEvent(this.state, e)
    if (ok) {
      this.log.append(e)
      this.applied += 1
      this.counts.set(e.source, (this.counts.get(e.source) ?? 0) + 1)
      this.recent.unshift(e)
      if (this.recent.length > 50) this.recent.pop()
      const latency = Date.now() - new Date(e.at).getTime()
      if (latency >= 0 && latency < 60_000) this.freshness.push(latency)
      if (this.freshness.length > 500) this.freshness.shift()
    } else {
      this.rejected += 1
    }
    return ok
  }

  /** Latency samples for the twin-freshness architecture metric. */
  freshnessSamples(): number[] { return [...this.freshness] }

  /** Persist a snapshot so replay does not have to fold the whole log every boot. */
  snapshot(): void { this.log.saveSnapshot(this.state) }

  /** Advance the twin's logical clock once per heartbeat. */
  markTick(): void {
    this.state.tick += 1
    this.state.lastTickAt = new Date().toISOString()
  }

  twin(): TwinState { return this.state }
  recentEvents(limit = 12): OrgEvent[] { return this.recent.slice(0, limit) }

  report(): { connectors: ConnectorReport[]; applied: number; rejected: number; liveSources: number } {
    const connectors = this.connectors.map((c) => ({
      id: c.id, name: c.name, observes: c.observes,
      status: c.status(), eventsEmitted: this.counts.get(c.id) ?? 0,
    }))
    return {
      connectors,
      applied: this.applied,
      rejected: this.rejected,
      // How many REAL enterprise systems are feeding the twin (synthetic excluded).
      liveSources: connectors.filter((c) => c.status === 'live' && c.id !== 'synthetic').length,
    }
  }
}

export const perception = new PerceptionLayer()
