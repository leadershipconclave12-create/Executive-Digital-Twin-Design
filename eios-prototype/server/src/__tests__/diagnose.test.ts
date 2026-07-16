import { describe, it, expect } from 'vitest'

// The diagnose() logic lives in web/src/api.ts, which has no test runner of its own.
// It is replicated here because getting it WRONG is what wasted a deploy: the old
// message told a user on a Vercel URL to check whether a server was running on :4180.
// These tests pin the decision table.

type Case = { apiBase: string; token: string; host: string; status?: number }

function diagnose({ apiBase, token, host, status }: Case): string {
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  if (status === 401) {
    return token
      ? 'Backend rejected the access token. VITE_ACCESS_TOKEN must match EIOS_ACCESS_TOKEN on the server — and Vite inlines it at BUILD time, so rebuild after changing it.'
      : 'Backend requires an access token. Set VITE_ACCESS_TOKEN in the web build to match EIOS_ACCESS_TOKEN on the server.'
  }
  if (status === 403) return 'Backend refused this request as unprotected and non-local. Set EIOS_ACCESS_TOKEN on the server (and VITE_ACCESS_TOKEN here). See DEPLOY.md.'
  if (!apiBase && !isLocal) {
    return 'No backend is configured. This is a static deploy of the UI only — there is no EIOS server behind it. EIOS needs an always-on backend (4s heartbeat, event log on disk, SSE); serverless cannot host it. Deploy the backend (see DEPLOY.md / render.yaml), then set VITE_API_URL to its URL and rebuild.'
  }
  if (!apiBase && isLocal) return 'Cannot reach the EIOS backend on :4180. Start it with "npm run dev" from eios-prototype/.'
  return `Backend at ${apiBase} is unreachable${status ? ` (HTTP ${status})` : ''}. It may be asleep (free tiers idle out), still deploying, or the URL may be wrong.`
}

describe('Backend-unreachable diagnosis', () => {
  it('THE VERCEL CASE: static deploy, no backend — says so, and does not mention :4180', () => {
    const msg = diagnose({ apiBase: '', token: '', host: 'eios.vercel.app' })
    expect(msg).toMatch(/static deploy/i)
    expect(msg).toMatch(/serverless cannot host it/i)
    // The old message asked a localhost question on a cloud URL. Never again.
    expect(msg).not.toMatch(/4180/)
  })

  it('localhost with no server running — tells you the command', () => {
    const msg = diagnose({ apiBase: '', token: '', host: 'localhost' })
    expect(msg).toMatch(/4180/)
    expect(msg).toMatch(/npm run dev/)
  })

  it('configured backend unreachable — names the URL and the likely cause', () => {
    const msg = diagnose({ apiBase: 'https://eios.onrender.com', token: 't', host: 'eios.vercel.app' })
    expect(msg).toMatch(/eios\.onrender\.com/)
    expect(msg).toMatch(/asleep/i) // free tiers idle out — the most common real cause
  })

  it('401 with a token — points at the build-time inlining trap', () => {
    const msg = diagnose({ apiBase: 'https://x.com', token: 'wrong', host: 'v.app', status: 401 })
    expect(msg).toMatch(/BUILD time/)
    expect(msg).toMatch(/rebuild/i)
  })

  it('401 without a token — tells you to set one', () => {
    const msg = diagnose({ apiBase: 'https://x.com', token: '', host: 'v.app', status: 401 })
    expect(msg).toMatch(/requires an access token/i)
  })

  it('403 — explains the fail-closed guard rather than looking like a crash', () => {
    const msg = diagnose({ apiBase: 'https://x.com', token: '', host: 'v.app', status: 403 })
    expect(msg).toMatch(/unprotected/i)
    expect(msg).toMatch(/EIOS_ACCESS_TOKEN/)
  })

  it('never returns an empty message — the old bug rendered a bare "()"', () => {
    const cases: Case[] = [
      { apiBase: '', token: '', host: 'x.vercel.app' },
      { apiBase: '', token: '', host: 'localhost' },
      { apiBase: 'https://a.com', token: '', host: 'x.app' },
      { apiBase: 'https://a.com', token: 't', host: 'x.app', status: 401 },
      { apiBase: 'https://a.com', token: 't', host: 'x.app', status: 403 },
      { apiBase: 'https://a.com', token: 't', host: 'x.app', status: 500 },
    ]
    for (const c of cases) expect(diagnose(c).length).toBeGreaterThan(20)
  })
})
