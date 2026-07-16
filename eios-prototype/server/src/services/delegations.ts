import type { AuthorityLevel, Delegation, DelegationStatus, User } from '../domain/types.js'
import type { Store } from '../data/store.js'
import { bus, Events } from '../events/bus.js'

export class DelegationError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'authority' | 'invalid') {
    super(message)
  }
}

const AUTHORITY_NOTE: Record<AuthorityLevel, string> = {
  L1: 'Investigate',
  L2: 'Recommend',
  L3: 'Execute (bounded)',
  L4: 'Execute (full)',
  L5: 'Standing delegation',
}

export function listDelegations(store: Store): Delegation[] {
  return store.delegations
}

let counter = 43

/**
 * Create a delegation (Vol 2 Ch 8). L3+ requires a spend cap; only the Deputy
 * Chief (or Chief of Staff) may originate delegations, enforced at the route via
 * RBAC — here we validate the entity's internal consistency.
 */
export function createDelegation(
  store: Store,
  input: {
    user: User
    delegate: string
    subject: string
    authorityLevel: AuthorityLevel
    spendCapInr?: number
    priority?: Delegation['priority']
    deadline?: string
    context?: string
  },
): Delegation {
  if (!input.delegate.trim() || !input.subject.trim()) {
    throw new DelegationError('delegate and subject are required', 'invalid')
  }
  const needsCap = input.authorityLevel === 'L3'
  if (needsCap && (input.spendCapInr === undefined || input.spendCapInr <= 0)) {
    throw new DelegationError('L3 (bounded execution) requires a positive spend cap', 'invalid')
  }
  if (input.spendCapInr && input.spendCapInr > input.user.financialAuthorityInr) {
    throw new DelegationError(
      `Cannot delegate a ₹${input.spendCapInr.toLocaleString('en-IN')} cap beyond your own authority of ₹${input.user.financialAuthorityInr.toLocaleString('en-IN')}`,
      'authority',
    )
  }

  const id = `DEL-2026-07-16-00${counter++}`
  const delegation: Delegation = {
    id,
    delegator: input.user.name,
    delegate: input.delegate,
    subject: input.subject,
    context: input.context,
    authorityLevel: input.authorityLevel,
    authorityNote: AUTHORITY_NOTE[input.authorityLevel],
    spendCapInr: input.spendCapInr,
    priority: input.priority ?? 'Medium',
    deadline: input.deadline ?? 'EOD',
    status: 'Notified',
    progress: 5,
    createdAt: new Date().toISOString(),
  }
  store.delegations.unshift(delegation)
  bus.publish(Events.DelegationCreated, {
    actor: input.user.name, actorRole: input.user.role, resource: id,
    detail: `${input.authorityLevel} → ${input.delegate}: ${input.subject}`,
  })
  return delegation
}

const VALID_TRANSITIONS: Record<DelegationStatus, DelegationStatus[]> = {
  Notified: ['In Progress', 'At Risk', 'Escalated'],
  'In Progress': ['At Risk', 'Completed', 'Escalated'],
  'At Risk': ['In Progress', 'Escalated', 'Completed'],
  Escalated: ['In Progress', 'Completed'],
  Completed: [],
}

export function updateDelegation(
  store: Store,
  id: string,
  input: { status?: DelegationStatus; progress?: number; actor: User },
): Delegation {
  const d = store.delegations.find((x) => x.id === id)
  if (!d) throw new DelegationError(`Delegation ${id} not found`, 'not_found')

  if (input.status && input.status !== d.status) {
    if (!VALID_TRANSITIONS[d.status].includes(input.status)) {
      throw new DelegationError(`Illegal transition ${d.status} → ${input.status}`, 'invalid')
    }
    d.status = input.status
    if (input.status === 'Completed') d.progress = 100
  }
  if (input.progress !== undefined) d.progress = Math.max(0, Math.min(100, input.progress))

  bus.publish(Events.DelegationUpdated, {
    actor: input.actor.name, actorRole: input.actor.role, resource: id,
    detail: `status=${d.status} progress=${d.progress}%`,
  })
  return d
}
