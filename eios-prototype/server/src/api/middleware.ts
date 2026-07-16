import type { NextFunction, Request, Response } from 'express'
import type { User } from '../domain/types.js'
import { currentUser } from '../governance/rbac.js'
import { config } from '../config.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

/**
 * SINGLE USER. EIOS serves one person, so there is no permission check to make — a gate
 * that can never deny is theatre (ADR-010).
 *
 * But "one user" is an assumption about WHO CAN REACH THE PORT. On localhost that holds.
 * The moment this is deployed to a public URL it does not: anyone who finds the URL would
 * be treated as the Deputy Chief, with access to his memory, decisions and mailbox.
 *
 * So: if EIOS_ACCESS_TOKEN is set, it is required. If it is not set, we refuse to serve
 * anything except from localhost. There is no configuration in which this is open to the
 * internet by accident.
 *
 * This is a shared secret, not authentication — it is the minimum that makes a personal
 * deployment safe. Real auth is Entra ID JWT validation, and this function is its seam.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = config.accessToken

  if (token) {
    // Header for normal calls; query param for SSE (EventSource cannot set headers).
    const provided = req.header('x-eios-token') || (req.query.token as string) || ''
    if (provided !== token) {
      res.status(401).json({ error: 'Invalid or missing access token. Set VITE_ACCESS_TOKEN in the web build, or send x-eios-token.' })
      return
    }
  } else if (!isLocal(req)) {
    // No token AND not local ⇒ this is exposed and unprotected. Fail closed, loudly.
    res.status(403).json({
      error:
        'EIOS is unprotected and this request is not from localhost. Set EIOS_ACCESS_TOKEN on the server ' +
        '(and VITE_ACCESS_TOKEN in the web build) before exposing it. See DEPLOY.md.',
    })
    return
  }

  req.user = currentUser()
  next()
}

/** Is this request from the machine EIOS is running on? */
function isLocal(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? ''
  return (
    ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.') || ip === 'localhost'
  )
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const anyErr = err as { code?: string; message?: string }
  const status =
    anyErr.code === 'not_found' ? 404 :
    anyErr.code === 'authority' || anyErr.code === 'guardrail' ? 403 :
    anyErr.code === 'invalid' || anyErr.code === 'already_resolved' ? 409 : 500
  res.status(status).json({ error: anyErr.message ?? 'Internal error', code: anyErr.code })
}
