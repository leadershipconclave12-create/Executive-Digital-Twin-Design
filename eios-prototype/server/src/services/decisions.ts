import type { DecisionItem, User } from '../domain/types.js'
import type { Store } from '../data/store.js'
import { bus, Events } from '../events/bus.js'
import { canUserApprove, evaluateAutoExecution } from '../governance/guardrails.js'

export class DecisionError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'already_resolved' | 'authority' | 'guardrail') {
    super(message)
  }
}

export function listDecisions(store: Store): DecisionItem[] {
  return store.decisions
}

export function getDecision(store: Store, id: string): DecisionItem | undefined {
  return store.decisions.find((d) => d.id === id)
}

/** Human resolution of a pending decision (approve/reject), enforcing ABAC authority. */
export function resolveDecision(
  store: Store,
  id: string,
  input: { decision: 'approved' | 'rejected'; user: User; rationale?: string },
): DecisionItem {
  const item = getDecision(store, id)
  if (!item) throw new DecisionError(`Decision ${id} not found`, 'not_found')
  if (item.status !== 'pending') throw new DecisionError(`Decision ${id} is already ${item.status}`, 'already_resolved')

  if (input.decision === 'approved') {
    const authority = canUserApprove(input.user, item)
    if (!authority.allowed) throw new DecisionError(authority.reason, 'authority')
  }

  item.status = input.decision
  item.decidedBy = input.user.name
  item.decidedAt = new Date().toISOString()
  item.rationale = input.rationale

  bus.publish(Events.DecisionResolved, {
    actor: input.user.name,
    actorRole: input.user.role,
    resource: item.id,
    detail: `${input.decision} — ${item.type}${item.amountLabel ? ` (${item.amountLabel})` : ''}`,
  })
  return item
}

/**
 * Attempt autonomous execution of a decision (called by agents, not humans).
 * The ₹10L hard-limit and confidence threshold are enforced by the guardrail;
 * a blocked attempt is journalled and the decision stays pending for a human.
 */
export function attemptAutoExecute(store: Store, id: string): { executed: boolean; reason: string } {
  const item = getDecision(store, id)
  if (!item) return { executed: false, reason: 'not found' }
  if (item.status !== 'pending') return { executed: false, reason: `already ${item.status}` }

  const guard = evaluateAutoExecution(item)
  if (!guard.allowed) {
    bus.publish(Events.GuardrailBlocked, {
      actor: 'EIOS', actorRole: 'system', resource: item.id, detail: guard.reason,
    })
    return { executed: false, reason: guard.reason }
  }

  item.status = 'auto-executed'
  item.decidedBy = 'EIOS (autonomous)'
  item.decidedAt = new Date().toISOString()
  bus.publish(Events.DecisionResolved, {
    actor: 'EIOS', actorRole: 'system', resource: item.id, detail: `auto-executed — ${item.type}`,
  })
  return { executed: true, reason: guard.reason }
}
