import { createHash } from 'node:crypto'
import type { AuditEvent, Role } from '../domain/types.js'
import { bus } from '../events/bus.js'

// Immutable, tamper-evident decision journal (Vol 7 Ch 10). Each entry hashes its
// content together with the previous entry's hash, forming a chain: any retroactive
// edit breaks verification. In production this is backed by append-only WORM storage.
class AuditLog {
  private events: AuditEvent[] = []
  private static readonly GENESIS = '0'.repeat(64)

  record(input: {
    actor: string
    actorRole: Role | 'system'
    action: string
    resource: string
    detail: string
  }): AuditEvent {
    const seq = this.events.length + 1
    const prevHash = this.events.at(-1)?.hash ?? AuditLog.GENESIS
    const timestamp = new Date().toISOString()
    const material = `${seq}|${timestamp}|${input.actor}|${input.actorRole}|${input.action}|${input.resource}|${input.detail}|${prevHash}`
    const hash = createHash('sha256').update(material).digest('hex')
    const event: AuditEvent = { seq, timestamp, ...input, prevHash, hash }
    this.events.push(event)
    return event
  }

  list(limit = 200): AuditEvent[] {
    // Return deep copies so consumers can never mutate the stored journal.
    return this.events.slice(-limit).reverse().map((e) => ({ ...e }))
  }

  /** Re-derive the chain to prove no entry was altered. */
  verify(): { valid: boolean; brokenAt?: number } {
    let prevHash = AuditLog.GENESIS
    for (const e of this.events) {
      const material = `${e.seq}|${e.timestamp}|${e.actor}|${e.actorRole}|${e.action}|${e.resource}|${e.detail}|${prevHash}`
      const expected = createHash('sha256').update(material).digest('hex')
      if (expected !== e.hash || e.prevHash !== prevHash) {
        return { valid: false, brokenAt: e.seq }
      }
      prevHash = e.hash
    }
    return { valid: true }
  }

  size(): number {
    return this.events.length
  }
}

export const auditLog = new AuditLog()

// Auto-journal every domain event so nothing EIOS does is invisible to audit.
bus.on('*', (e) => {
  const p = (e.payload ?? {}) as Record<string, unknown>
  auditLog.record({
    actor: (p.actor as string) ?? 'system',
    actorRole: (p.actorRole as Role) ?? 'system',
    action: e.type,
    resource: (p.resource as string) ?? '-',
    detail: (p.detail as string) ?? '',
  })
})
