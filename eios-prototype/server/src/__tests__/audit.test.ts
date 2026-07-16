import { describe, it, expect } from 'vitest'
import { auditLog } from '../governance/audit.js'
import { bus } from '../events/bus.js'

describe('tamper-evident audit journal', () => {
  it('chains events and verifies integrity', () => {
    bus.publish('test.event', { actor: 'tester', actorRole: 'system', resource: 'r1', detail: 'first' })
    bus.publish('test.event', { actor: 'tester', actorRole: 'system', resource: 'r2', detail: 'second' })
    const result = auditLog.verify()
    expect(result.valid).toBe(true)
    expect(auditLog.size()).toBeGreaterThanOrEqual(2)
  })

  it('is immutable to consumers — mutating a returned entry cannot corrupt the journal', () => {
    const list = auditLog.list(1)
    ;(list[0] as { detail: string }).detail = 'tampered'
    // list() returns deep copies, so the stored chain is untouched and still verifies.
    expect(auditLog.verify().valid).toBe(true)
  })
})
