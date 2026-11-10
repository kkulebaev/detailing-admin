import type { Context, MiddlewareHandler } from 'hono'
import { StatusCodes, canCreateBookings, canEditBookings, type Role } from '@detailing-admin/shared'
import { getAuthToken } from './cookie.js'
import { verifyToken, type AuthTokenClaims } from './jwt.js'

// Дополняет каждый контекст Hono декодированной сессией. Ее кладет `requireAuth`,
// последующие обработчики читают через `c.get('user')`.
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

// Stateless-проверка сессии — декодирует JWT из cookie без единого чтения из БД,
// поэтому запись у вошедших пользователей работает, даже пока Postgres лежит.
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getAuthToken(c)
  if (!token) return unauthorized(c)
  const claims = await verifyToken(token)
  if (!claims) return unauthorized(c)
  c.set('user', claims)
  await next()
}

// Должен идти после `requireAuth` (опирается на `c.get('user')`).
function requireRole(allowed: (role: Role) => boolean): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user')
    if (!user || !allowed(user.role)) return forbidden(c)
    await next()
  }
}

export const requireAdmin = requireRole((role) => role === 'admin')
export const requireBookingAccess = requireRole(canCreateBookings)
export const requireBookingEdit = requireRole(canEditBookings)
