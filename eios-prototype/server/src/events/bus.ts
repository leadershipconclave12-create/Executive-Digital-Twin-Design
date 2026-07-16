import { EventEmitter } from 'node:events'

// In-process event backbone (Vol 4 Ch 7). In production this is Azure Event Grid /
// Service Bus; the domain code depends only on this thin publish/subscribe seam.
export interface DomainEvent {
  type: string
  payload: unknown
  at: string
}

class EventBus {
  private emitter = new EventEmitter()

  publish(type: string, payload: unknown): void {
    const evt: DomainEvent = { type, payload, at: new Date().toISOString() }
    this.emitter.emit(type, evt)
    this.emitter.emit('*', evt)
  }

  on(type: string, handler: (e: DomainEvent) => void): void {
    this.emitter.on(type, handler)
  }
}

export const bus = new EventBus()

// Canonical event names.
export const Events = {
  SignalReceived: 'signal.received',
  SignalHandled: 'signal.handled',
  DecisionCreated: 'decision.created',
  DecisionResolved: 'decision.resolved',
  DelegationCreated: 'delegation.created',
  DelegationUpdated: 'delegation.updated',
  GuardrailBlocked: 'guardrail.blocked',
  CommandExecuted: 'command.executed',
} as const
