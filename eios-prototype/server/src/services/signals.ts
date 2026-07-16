import type { Signal, SignalPriority, User } from '../domain/types.js'
import type { Store } from '../data/store.js'
import { bus, Events } from '../events/bus.js'

const RANK: Record<SignalPriority, number> = { urgent: 0, critical: 1, routine: 2, informational: 3 }

export function listSignals(store: Store): Signal[] {
  return [...store.signals].sort((a, b) => RANK[a.priority] - RANK[b.priority])
}

export function handleSignal(store: Store, id: string, user: User): Signal {
  const s = store.signals.find((x) => x.id === id)
  if (!s) throw new Error(`Signal ${id} not found`)
  s.handled = true
  bus.publish(Events.SignalHandled, {
    actor: user.name, actorRole: user.role, resource: id, detail: `cleared: ${s.title}`,
  })
  return s
}
