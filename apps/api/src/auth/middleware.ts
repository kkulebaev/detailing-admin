import type { Context, MiddlewareHandler } from 'hono'
import { StatusCodes } from '@detailing-admin/shared'
import { getAuthToken } from './cookie.js'
import { verifyToken, type AuthTokenClaims } from './jwt.js'

// Augments every Hono context with the decoded session. Set by `requireAuth`;
// downstream handlers read it via `c.get('user')`.
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthTokenClaims
  }
}

function unauthorized(c: Context) {
  return c.json({ ok: false as const, error: 'unauthorized' as const }, StatusCodes.UNAUTHORIZED)
}

function forbidden(c: Context) {
  return c.json({ ok: false as const, error: 'forbidden' as const }, StatusCodes.FORBIDDEN)
}

// Stateless session gate — decodes the cookie's JWT with zero DB reads, so the
// booking flow keeps working for logged-in users while Postgres is down.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getAuthToken(c)
  if (!token) return unauthorized(c)
  const claims = await verifyToken(token)
  if (!claims) return unauthorized(c)
  c.set('user', claims)
  await next()
}

// Must run after `requireAuth` (relies on `c.get('user')`).
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return forbidden(c)
  await next()
}
