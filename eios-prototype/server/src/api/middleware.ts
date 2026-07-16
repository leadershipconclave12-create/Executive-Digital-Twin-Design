import type { NextFunction, Request, Response } from 'express'
import type { User } from '../domain/types.js'
import { currentUser } from '../governance/rbac.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

/**
 * SINGLE USER. EIOS serves one person, so authentication resolves to him and there is no
 * permission check to make — a gate that can never deny is theatre.
 *
 * This still exists for two real reasons:
 *   1. The audit journal must record a typed actor, not "someone".
 *   2. It is the seam where Entra ID JWT validation lands when this leaves the laptop.
 *      Right now anyone who can reach the port is the Deputy Chief — which is fine for a
 *      localhost tool and NOT fine the moment it is exposed. See docs/ARCHITECTURE.md §7.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  req.user = currentUser()
  next()
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const anyErr = err as { code?: string; message?: string }
  const status =
    anyErr.code === 'not_found' ? 404 :
    anyErr.code === 'authority' || anyErr.code === 'guardrail' ? 403 :
    anyErr.code === 'invalid' || anyErr.code === 'already_resolved' ? 409 : 500
  res.status(status).json({ error: anyErr.message ?? 'Internal error', code: anyErr.code })
}
