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
  if (!res.ok) {
    // A bare 404 from a static host has no JSON body and often an empty statusText,
    // which used to surface to the user as an empty "()". Never emit a blank error.
    throw new ApiError(body?.error || res.statusText || `HTTP ${res.status}`, res.status)
  }
  return body as T
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** Is the browser pointed at a backend on this machine? */
function isLocalHost(): boolean {
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

/**
 * Turn "it didn't work" into "here is what is wrong and what to do".
 *
 * The common case is a static deploy (Vercel/Netlify) with no backend: the UI is served,
 * every /api call 404s, and the old message unhelpfully asked whether a server was
 * running on :4180 — a localhost question on a cloud URL.
 */
export function diagnose(e: unknown): string {
  const err = e as ApiError
  const status = err?.status
  const where = API_BASE || window.location.origin

  if (status === 401) {
    return ACCESS_TOKEN
      ? `Backend rejected the access token. VITE_ACCESS_TOKEN must match EIOS_ACCESS_TOKEN on the server — and Vite inlines it at BUILD time, so rebuild after changing it.`
      : `Backend requires an access token. Set VITE_ACCESS_TOKEN in the web build to match EIOS_ACCESS_TOKEN on the server.`
  }
  if (status === 403) {
    return `Backend refused this request as unprotected and non-local. Set EIOS_ACCESS_TOKEN on the server (and VITE_ACCESS_TOKEN here). See DEPLOY.md.`
  }
  if (!API_BASE && !isLocalHost()) {
    // The exact situation a Vercel deploy lands in.
    return `No backend is configured. This is a static deploy of the UI only — there is no EIOS server behind it. `
      + `EIOS needs an always-on backend (4s heartbeat, event log on disk, SSE); serverless cannot host it. `
      + `Deploy the backend (see DEPLOY.md / render.yaml), then set VITE_API_URL to its URL and rebuild.`
  }
  if (!API_BASE && isLocalHost()) {
    return `Cannot reach the EIOS backend on :4180. Start it with "npm run dev" from eios-prototype/.`
  }
  return `Backend at ${where} is unreachable${status ? ` (HTTP ${status})` : ''}. `
    + `It may be asleep (free tiers idle out), still deploying, or the URL may be wrong.`
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
