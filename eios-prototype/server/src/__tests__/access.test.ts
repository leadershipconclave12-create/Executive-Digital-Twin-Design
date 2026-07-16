import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

// The access guard. EIOS has ONE user and no login — which is fine on localhost and
// dangerous the moment it is deployed. These tests exist because "we'll remember to set
// the token" is not a security control.

async function loadMiddleware(token: string) {
  vi.resetModules()
  process.env.EIOS_ACCESS_TOKEN = token
  return (await import('../api/middleware.js')).authenticate
}

const mkRes = () => {
  const res = { statusCode: 0, body: null as unknown } as unknown as Response & { statusCode: number; body: unknown }
  res.status = vi.fn().mockImplementation((c: number) => { res.statusCode = c; return res }) as never
  res.json = vi.fn().mockImplementation((b: unknown) => { res.body = b; return res }) as never
  return res
}

const mkReq = (over: Partial<Request> & { ip?: string } = {}): Request => ({
  header: (n: string) => (over.headers as Record<string, string>)?.[n.toLowerCase()],
  query: {},
  socket: { remoteAddress: over.ip ?? '127.0.0.1' },
  ...over,
} as unknown as Request)

beforeEach(() => { delete process.env.EIOS_ACCESS_TOKEN })

describe('Access guard — no token configured', () => {
  it('allows localhost (the normal way EIOS is used)', async () => {
    const authenticate = await loadMiddleware('')
    const req = mkReq({ ip: '127.0.0.1' })
    const res = mkRes()
    const next = vi.fn()
    authenticate(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.user?.role).toBe('deputy_chief')
  })

  it('FAILS CLOSED for a remote request — an unprotected deploy serves nobody', async () => {
    // This is the whole point: deploying without a token must not silently expose
    // the executive's memory, decisions and mailbox to anyone who finds the URL.
    const authenticate = await loadMiddleware('')
    const req = mkReq({ ip: '203.0.113.42' })
    const res = mkRes()
    const next = vi.fn()
    authenticate(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect((res.body as { error: string }).error).toMatch(/unprotected/i)
  })

  it('recognises IPv6 loopback as local', async () => {
    const authenticate = await loadMiddleware('')
    const next = vi.fn()
    authenticate(mkReq({ ip: '::1' }), mkRes(), next)
    expect(next).toHaveBeenCalled()
  })
})

describe('Access guard — token configured', () => {
  it('rejects a request with no token', async () => {
    const authenticate = await loadMiddleware('s3cret')
    const res = mkRes()
    const next = vi.fn()
    authenticate(mkReq({ ip: '203.0.113.42' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const authenticate = await loadMiddleware('s3cret')
    const res = mkRes()
    const next = vi.fn()
    authenticate(mkReq({ ip: '203.0.113.42', headers: { 'x-eios-token': 'guess' } }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('accepts the right token from anywhere', async () => {
    const authenticate = await loadMiddleware('s3cret')
    const req = mkReq({ ip: '203.0.113.42', headers: { 'x-eios-token': 's3cret' } })
    const next = vi.fn()
    authenticate(req, mkRes(), next)
    expect(next).toHaveBeenCalled()
    expect(req.user?.title).toBe('Deputy Chief (Products)')
  })

  it('accepts the token via query param — EventSource cannot set headers', async () => {
    const authenticate = await loadMiddleware('s3cret')
    const req = mkReq({ ip: '203.0.113.42' })
    ;(req as unknown as { query: Record<string, string> }).query = { token: 's3cret' }
    const next = vi.fn()
    authenticate(req, mkRes(), next)
    expect(next).toHaveBeenCalled()
  })

  it('requires the token even from localhost once one is set — no local bypass', async () => {
    const authenticate = await loadMiddleware('s3cret')
    const res = mkRes()
    const next = vi.fn()
    authenticate(mkReq({ ip: '127.0.0.1' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})
