import type {
  Overview, Signal, DecisionItem, Delegation, Agent, AuditEvent, User, CommandResponse,
  PulseSnapshot, MemoryOverview, RecallAnswer, QualityReport, WisdomCandidate,
} from './types'

// Thin API client for the single user (the Deputy Chief).
//
// WHERE IS THE API?
//   - dev / single-container: same origin. Vite proxies /api -> :4180; in prod the
//     Express server serves the built UI itself. Leave VITE_API_URL unset.
//   - split deploy (UI on a static host, backend elsewhere): set VITE_API_URL to the
//     backend's public origin at BUILD time, e.g. https://eios-api.onrender.com
//
// Vite inlines VITE_* at build time — changing it needs a rebuild, not a restart.
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

/**
 * Optional shared secret. Required only when the backend sets EIOS_ACCESS_TOKEN
 * (i.e. any deploy that is not localhost). Never commit a real value.
 */
const ACCESS_TOKEN = import.meta.env.VITE_ACCESS_TOKEN ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`
}

function authHeaders(): Record<string, string> {
  return ACCESS_TOKEN ? { 'x-eios-token': ACCESS_TOKEN } : {}
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
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

/**
 * Subscribe to the live organizational heartbeat via Server-Sent Events.
 *
 * NOTE: SSE needs a backend process that stays alive. It does not work on serverless
 * (Vercel/Netlify functions) — see DEPLOY.md.
 */
export function streamPulse(onSnapshot: (snap: PulseSnapshot) => void): () => void {
  // EventSource cannot set headers, so the token rides as a query param when present.
  const q = ACCESS_TOKEN ? `?token=${encodeURIComponent(ACCESS_TOKEN)}` : ''
  const es = new EventSource(apiUrl(`/pulse/stream${q}`))
  es.onmessage = (e) => {
    try { onSnapshot(JSON.parse(e.data) as PulseSnapshot) } catch { /* ignore */ }
  }
  return () => es.close()
}
