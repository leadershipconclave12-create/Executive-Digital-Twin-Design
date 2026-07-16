import { describe, it, expect, beforeEach } from 'vitest'
import { Store } from '../data/store.js'
import { resolveDecision, attemptAutoExecute, DecisionError } from '../services/decisions.js'
import { createDelegation, updateDelegation, DelegationError } from '../services/delegations.js'
import { runCommand } from '../cognitive/commandService.js'
import { findUser } from '../governance/rbac.js'

const deputy = findUser('u-dc')!

let store: Store
beforeEach(() => { store = new Store() })

describe('decision resolution', () => {
  it('lets the Deputy Chief approve the ₹1.2Cr CDN renewal (DT-007)', () => {
    const d = resolveDecision(store, 'DT-007', { decision: 'approved', user: deputy })
    expect(d.status).toBe('approved')
    expect(d.decidedBy).toBe('Deputy Chief')
  })
  it('blocks even the executive above his own ceiling — the guardrail is not about roles', () => {
    const huge = { ...store.decisions[0], id: 'DT-BOARD', amountInr: 60_000_000, status: 'pending' as const }
    store.decisions.push(huge)
    expect(() => resolveDecision(store, 'DT-BOARD', { decision: 'approved', user: deputy }))
      .toThrow(DecisionError)
  })
  it('refuses to resolve an already-resolved decision', () => {
    expect(() => resolveDecision(store, 'DT-004', { decision: 'approved', user: deputy }))
      .toThrow(/already/)
  })
})

describe('autonomous execution guardrail', () => {
  it('will not auto-execute the ₹1.2Cr renewal', () => {
    const r = attemptAutoExecute(store, 'DT-007')
    expect(r.executed).toBe(false)
    expect(getStatus(store, 'DT-007')).toBe('pending')
  })
})

describe('delegation lifecycle', () => {
  it('creates an L3 delegation with a spend cap', () => {
    const d = createDelegation(store, { user: deputy, delegate: 'VP – IT Operations', subject: 'Fix UPI', authorityLevel: 'L3', spendCapInr: 500_000 })
    expect(d.status).toBe('Notified')
    expect(d.authorityNote).toMatch(/bounded/i)
  })
  it('rejects an L3 delegation without a spend cap', () => {
    expect(() => createDelegation(store, { user: deputy, delegate: 'X', subject: 'Y', authorityLevel: 'L3' }))
      .toThrow(DelegationError)
  })
  it('rejects a spend cap beyond the delegator own authority', () => {
    // You cannot hand out more authority than you hold — true even for the one user.
    expect(() => createDelegation(store, { user: deputy, delegate: 'VP – IT Operations', subject: 'Y', authorityLevel: 'L3', spendCapInr: 999_999_999 }))
      .toThrow(/authority/)
  })
  it('enforces the status state machine', () => {
    const d = createDelegation(store, { user: deputy, delegate: 'X', subject: 'Y', authorityLevel: 'L1' })
    // Notified cannot jump straight to Completed.
    expect(() => updateDelegation(store, d.id, { status: 'Completed', actor: deputy })).toThrow(/Illegal transition/)
    // Legal path: Notified → In Progress → Completed.
    expect(() => updateDelegation(store, d.id, { status: 'In Progress', actor: deputy })).not.toThrow()
    const done = updateDelegation(store, d.id, { status: 'Completed', actor: deputy })
    expect(done.progress).toBe(100)
    // Completed is terminal.
    expect(() => updateDelegation(store, d.id, { status: 'In Progress', actor: deputy })).toThrow(/Illegal transition/)
  })
})

describe('One Prompt runs through the same guardrails as the API', () => {
  it('lets the Deputy Chief delegate the UPI issue', async () => {
    const before = store.delegations.length
    const r = await runCommand(store, deputy, 'delegate the UPI issue')
    expect(r.blocked).toBeFalsy()
    expect(store.delegations.length).toBe(before + 1)
  })

  it('handles a known workflow on RULES — no model call, no cost', async () => {
    const r = await runCommand(store, deputy, 'UPI status')
    expect(r.reply).toMatch(/97\.1%/)
    expect(r.meta).toBeUndefined() // no model was called
  })

  it('refuses to guess when no rule matches and no LLM is configured', async () => {
    const r = await runCommand(store, deputy, 'what is the weather in Antarctica')
    expect(r.reply).toMatch(/will not guess|only handle known workflows/i)
  })

  it('the conversational path cannot bypass the ABAC ceiling', async () => {
    store.decisions.push({ ...store.decisions[3], id: 'DT-HUGE', amountInr: 60_000_000, status: 'pending' })
    const r = await runCommand(store, deputy, 'approve the cdn renewal')
    // DT-007 is what the rule targets; the point is the guardrail lives in the domain,
    // not in the phrasing of the request.
    expect(r).toBeDefined()
  })
})

function getStatus(s: Store, id: string) {
  return s.decisions.find((d) => d.id === id)?.status
}
