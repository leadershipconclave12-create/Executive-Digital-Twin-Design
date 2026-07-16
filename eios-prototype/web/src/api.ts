import type {
  Overview, Signal, DecisionItem, Delegation, Agent, AuditEvent, User, CommandResponse,
  PulseSnapshot, MemoryOverview, RecallAnswer, QualityReport, WisdomCandidate,
} from './types'

// Thin API client. The current user id is sent as the x-eios-user header so the
// backend can enforce RBAC/ABAC (Vol 7) — switching the user in the UI genuinely
// changes what the server allows.
let currentUserId = 'u-dc'
export function setUser(id: string) { currentUserId = id }
export function getUserId() { return currentUserId }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-eios-user': currentUserId,
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body?.error ?? res.statusText, res.status)
  return body as T
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export const api = {
  users: () => req<User[]>('/auth/users'),
  me: () => req<{ user: User; permissions: string[] }>('/me'),
  overview: () => req<Overview>('/overview'),
  signals: () => req<Signal[]>('/signals'),
  handleSignal: (id: string) => req<Signal>(`/signals/${id}/handle`, { method: 'POST' }),
  decisions: () => req<DecisionItem[]>('/decisions'),
  resolveDecision: (id: string, decision: 'approved' | 'rejected') =>
    req<DecisionItem>(`/decisions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ decision }) }),
  delegations: () => req<Delegation[]>('/delegations'),
  agents: () => req<Agent[]>('/agents'),
  audit: () => req<{ integrity: { valid: boolean; brokenAt?: number }; events: AuditEvent[] }>('/audit'),
  command: (text: string) =>
    req<CommandResponse>('/command', { method: 'POST', body: JSON.stringify({ text }) }),
  pulse: () => req<PulseSnapshot>('/pulse'),
  memory: () => req<MemoryOverview>('/memory'),
  recall: (question: string) =>
    req<RecallAnswer>('/memory/recall', { method: 'POST', body: JSON.stringify({ question }) }),
  quality: () => req<QualityReport>('/knowledge/quality'),
  wisdomCandidates: () => req<WisdomCandidate[]>('/knowledge/wisdom/candidates'),
  approveWisdom: (id: string, rule?: string) =>
    req<{ id: string; rule: string }>(`/knowledge/wisdom/${id}/approve`, { method: 'POST', body: JSON.stringify({ rule }) }),
  rejectWisdom: (id: string) =>
    req<{ rejected: string }>(`/knowledge/wisdom/${id}/reject`, { method: 'POST' }),
}

/** Subscribe to the live organizational heartbeat via Server-Sent Events. */
export function streamPulse(onSnapshot: (snap: PulseSnapshot) => void): () => void {
  const es = new EventSource(`/api/pulse/stream?user=${encodeURIComponent(currentUserId)}`)
  es.onmessage = (e) => {
    try { onSnapshot(JSON.parse(e.data) as PulseSnapshot) } catch { /* ignore */ }
  }
  return () => es.close()
}
