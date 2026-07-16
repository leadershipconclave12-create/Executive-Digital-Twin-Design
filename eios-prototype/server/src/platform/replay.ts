import { createHash } from 'node:crypto'
import type { TwinState } from '../twin/model.js'
import { seedTwin } from '../twin/state.js'
import { applyEvent } from '../perception/reducer.js'
import type { EventStore } from './eventStore.js'

// Replay — rebuilding the organization from its history.
//
// The twin is a MATERIALIZED VIEW over the event log:
//
//   seed (or snapshot) + fold(applyEvent, events) = twin
//
// Because `applyEvent` is deterministic, the same log always reconstructs the same
// organization. That property is not a nicety — it is what makes the twin auditable,
// testable, and time-travellable. `verifyDeterminism()` proves it rather than assuming it.

/**
 * Canonical hash of the organization's DOMAIN state.
 *
 * Deliberately excludes runtime metadata (`tick`, `startedAt`, `lastTickAt`): those
 * describe the process, not the organization. Two replays at different wall-clock times
 * must produce the same hash — otherwise determinism is unverifiable.
 */
export function stateHash(twin: TwinState): string {
  const canonical = {
    projects: [...twin.projects].sort(byId).map(round),
    managers: [...twin.managers].sort(byId).map(round),
    vendors: [...twin.vendors].sort(byId).map(round),
    releases: [...twin.releases].sort(byId).map(round),
    channels: [...twin.channels].sort(byId).map(round),
    regulations: [...twin.regulations].sort(byId),
    customer: [...twin.customer].sort(byId).map(round),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)

/**
 * Float noise must not change the hash — we compare the organization, not IEEE artefacts.
 * Keys are also sorted so serialization order can never masquerade as a state change.
 */
function round(o: object): Record<string, unknown> {
  const src = o as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src).sort()) {
    const v = src[k]
    out[k] = typeof v === 'number' ? Number(v.toFixed(6)) : v
  }
  return out
}

export interface ReplayResult {
  twin: TwinState
  eventsApplied: number
  eventsRejected: number
  /** Log position the state reflects. */
  throughSeq: number
  hash: string
  durationMs: number
}

/**
 * Rebuild the organization from the log. `until` gives time travel; `from` resumes from
 * a snapshot. Rejected events are counted, never silently dropped.
 */
export function replay(store: EventStore, opts: { until?: string; snapshot?: { seq: number; state: TwinState } } = {}): ReplayResult {
  const started = Date.now()
  const twin: TwinState = opts.snapshot
    ? structuredClone(opts.snapshot.state)
    : seedTwin()

  const events = store.read({ from: opts.snapshot ? opts.snapshot.seq + 1 : undefined, until: opts.until })
  let applied = 0
  let rejected = 0
  for (const e of events) {
    if (applyEvent(twin, e)) applied += 1
    else rejected += 1
  }
  twin.tick = events.at(-1)?.seq ?? opts.snapshot?.seq ?? 0

  return {
    twin,
    eventsApplied: applied,
    eventsRejected: rejected,
    throughSeq: events.at(-1)?.seq ?? opts.snapshot?.seq ?? 0,
    hash: stateHash(twin),
    durationMs: Date.now() - started,
  }
}

/**
 * TIME TRAVEL — "show me the organization as it was on 14 March 2026."
 * Not a report: the actual reconstructed state at that instant.
 */
export function asOf(store: EventStore, timestamp: string): ReplayResult {
  return replay(store, { until: timestamp })
}

export interface DeterminismReport {
  deterministic: boolean
  hashA: string
  hashB: string
  eventsApplied: number
  detail: string
}

/**
 * REPLAY DETERMINISM — an architecture-level quality metric, not a unit test.
 * Replaying the same history twice must reconstruct byte-identical organizational state.
 * If this ever fails, every downstream guarantee (audit, time travel, knowledge replay)
 * is void — so the platform checks it rather than trusting it.
 */
export function verifyDeterminism(store: EventStore): DeterminismReport {
  const a = replay(store)
  const b = replay(store)
  const deterministic = a.hash === b.hash
  return {
    deterministic,
    hashA: a.hash,
    hashB: b.hash,
    eventsApplied: a.eventsApplied,
    detail: deterministic
      ? `Replaying ${a.eventsApplied} events twice reconstructed identical state.`
      : 'NON-DETERMINISTIC: identical history produced divergent state. Audit, time travel and knowledge replay cannot be trusted.',
  }
}

/**
 * KNOWLEDGE REPLAY — run today's reasoning against the organization as it existed then.
 * Answers "would today's system have caught this?" — the basis for validating a new
 * Executive Brain against history instead of against opinion.
 */
export function replayAgainstHistory<T>(
  store: EventStore,
  timestamp: string,
  reason: (twin: TwinState) => T,
): { at: string; twin: TwinState; result: T } {
  const { twin } = asOf(store, timestamp)
  return { at: timestamp, twin, result: reason(twin) }
}
