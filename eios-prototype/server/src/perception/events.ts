// The Perception Layer's canonical event model.
//
// The twin no longer drives itself with random drift. It is now EVENT-SOURCED:
// the only way its state changes is by applying a normalized OrgEvent that arrived
// from a Connector (a real enterprise system, or — for this POC — the synthetic
// connector). This is the architectural difference between "observing a simulation"
// and "an architecture built to observe the organization".

export type OrgEventKind =
  | 'project.progress'   // completion / plan moved
  | 'project.risk'       // risk score changed
  | 'channel.metric'     // UPI/IMPS/... success rate sample
  | 'vendor.sla'         // vendor SLA attainment sample (+ optional breach)
  | 'vendor.renewal'     // days-to-renewal updated
  | 'release.signal'     // release readiness / risk
  | 'comms.signal'       // engineering-manager communication/load signal
  | 'customer.metric'    // complaints / NPS / rating

export type SourceSystem =
  | 'synthetic'      // POC connector — clearly labelled, not a real system
  | 'ms-graph'       // Teams / Outlook / calendar (stub)
  | 'azure-devops'   // work items / pipelines (stub)
  | 'servicenow'     // incidents / changes (stub)
  | 'azure-monitor'  // production metrics / alerts (stub)
  | 'webhook'        // pushed via POST /api/events

export interface OrgEvent {
  id: string
  source: SourceSystem
  kind: OrgEventKind
  at: string
  entityId: string
  /** Kind-specific fields; the reducer reads only what it needs. */
  data: Record<string, number | string | boolean>
}

let seq = 0
export function makeEvent(
  source: SourceSystem,
  kind: OrgEventKind,
  entityId: string,
  data: OrgEvent['data'],
): OrgEvent {
  return { id: `EVT-${++seq}`, source, kind, entityId, at: new Date().toISOString(), data }
}

/** Validate an externally-supplied event (POST /api/events) before it touches the twin. */
export function validateEvent(input: unknown): OrgEvent | { error: string } {
  const e = input as Partial<OrgEvent>
  const kinds: OrgEventKind[] = [
    'project.progress', 'project.risk', 'channel.metric', 'vendor.sla',
    'vendor.renewal', 'release.signal', 'comms.signal', 'customer.metric',
  ]
  if (!e || typeof e !== 'object') return { error: 'event must be an object' }
  if (!e.kind || !kinds.includes(e.kind)) return { error: `kind must be one of ${kinds.join(', ')}` }
  if (!e.entityId || typeof e.entityId !== 'string') return { error: 'entityId (string) is required' }
  if (!e.data || typeof e.data !== 'object') return { error: 'data (object) is required' }
  return {
    id: e.id ?? `EVT-${++seq}`,
    source: (e.source as SourceSystem) ?? 'webhook',
    kind: e.kind,
    entityId: e.entityId,
    at: e.at ?? new Date().toISOString(),
    data: e.data,
  }
}
