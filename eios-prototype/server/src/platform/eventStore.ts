import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import type { OrgEvent } from '../perception/events.js'

// PHASE 2 — PLATFORM ENGINEERING · The Event Store.
//
// Until now the twin was STATE that events mutated. State dies on restart and cannot be
// questioned about the past. This inverts it:
//
//   Event → Immutable Log → Replay → Materialized Views → Organizational Twin
//
// The log becomes the system of record. The twin becomes a *derived view* of it. That
// single change buys: durability, replay, rebuild, time travel, audit of every input,
// and the ability to run tomorrow's reasoning against yesterday's organization.
//
// HONEST SCOPE: this is an append-only JSONL log on local disk with periodic snapshots.
// It is deliberately the simplest thing that gives real durability and exact replay. In
// production this seam is Kafka / Azure Event Hubs + blob snapshots — same contract,
// different substrate. It is NOT distributed, replicated, or HA.

export interface StoredEvent extends OrgEvent {
  /** Monotonic position in the log. The ordering is the truth. */
  seq: number
  storedAt: string
}

export interface Snapshot<T> {
  /** Log position this snapshot reflects — replay resumes from seq+1. */
  seq: number
  at: string
  state: T
}

export interface EventStoreOptions {
  /** Path to the append-only log. Omit for a purely in-memory store (tests). */
  path?: string
  snapshotPath?: string
}

export class EventStore {
  private events: StoredEvent[] = []
  private readonly path?: string
  private readonly snapshotPath?: string

  constructor(opts: EventStoreOptions = {}) {
    this.path = opts.path
    this.snapshotPath = opts.snapshotPath
    if (this.path) this.load()
  }

  /**
   * Append is the ONLY mutation. Events are never updated or deleted — a correction is
   * a new event. This is what makes the log auditable and replay exact.
   */
  append(e: OrgEvent): StoredEvent {
    const stored: StoredEvent = { ...e, seq: this.events.length + 1, storedAt: new Date().toISOString() }
    this.events.push(stored)
    if (this.path) {
      // Durability before acknowledgement: if this throws, the caller must know the
      // event was not persisted rather than believe a lie.
      appendFileSync(this.path, JSON.stringify(stored) + '\n', 'utf8')
    }
    return stored
  }

  appendMany(events: OrgEvent[]): StoredEvent[] {
    return events.map((e) => this.append(e))
  }

  /** Read a slice of history. `until` enables time travel; `from` enables snapshot resume. */
  read(opts: { from?: number; to?: number; until?: string } = {}): StoredEvent[] {
    let out = this.events
    if (opts.from !== undefined) out = out.filter((e) => e.seq >= opts.from!)
    if (opts.to !== undefined) out = out.filter((e) => e.seq <= opts.to!)
    if (opts.until !== undefined) {
      const cut = new Date(opts.until).getTime()
      out = out.filter((e) => new Date(e.at).getTime() <= cut)
    }
    return out
  }

  count(): number { return this.events.length }
  head(): StoredEvent | undefined { return this.events.at(-1) }
  first(): StoredEvent | undefined { return this.events[0] }

  /** Integrity digest over the whole log — two stores with the same digest saw the same history. */
  digest(): string {
    const h = createHash('sha256')
    for (const e of this.events) h.update(`${e.seq}|${e.kind}|${e.entityId}|${JSON.stringify(e.data)}`)
    return h.digest('hex')
  }

  // --- persistence --------------------------------------------------------
  private load(): void {
    if (!this.path || !existsSync(this.path)) return
    const raw = readFileSync(this.path, 'utf8').split('\n').filter(Boolean)
    const loaded: StoredEvent[] = []
    for (const [i, line] of raw.entries()) {
      try {
        loaded.push(JSON.parse(line) as StoredEvent)
      } catch {
        // A corrupt tail (e.g. a torn write on crash) must not poison the whole log.
        // Truncate at the last good record and say so, rather than silently continuing.
        // eslint-disable-next-line no-console
        console.warn(`[event-store] corrupt record at line ${i + 1}; truncating log there.`)
        break
      }
    }
    this.events = loaded
  }

  saveSnapshot<T>(state: T): Snapshot<T> | undefined {
    if (!this.snapshotPath) return undefined
    const snap: Snapshot<T> = { seq: this.events.length, at: new Date().toISOString(), state }
    writeFileSync(this.snapshotPath, JSON.stringify(snap), 'utf8')
    return snap
  }

  loadSnapshot<T>(): Snapshot<T> | undefined {
    if (!this.snapshotPath || !existsSync(this.snapshotPath)) return undefined
    try {
      return JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as Snapshot<T>
    } catch {
      return undefined // a bad snapshot is recoverable: replay from seq 0
    }
  }

  stats(): { events: number; durable: boolean; path?: string; firstAt?: string; lastAt?: string; digest: string } {
    return {
      events: this.events.length,
      durable: Boolean(this.path),
      path: this.path,
      firstAt: this.first()?.at,
      lastAt: this.head()?.at,
      digest: this.digest().slice(0, 16),
    }
  }
}

export function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
