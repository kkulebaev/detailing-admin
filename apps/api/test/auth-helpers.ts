// Shared helpers for route tests that must clear the auth guards.
//
// The auth env fields below must also be present in each test file's
// `vi.mock('../src/env.js')` factory (they can't be referenced from inside the
// hoisted factory, so they're inlined there); this object documents the shape.
import { signToken, type AuthTokenClaims } from '../src/auth/jwt.js'
import { AUTH_COOKIE_NAME } from '../src/auth/cookie.js'

export const AUTH_ENV = {
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
  AUTH_COOKIE_SECURE: false,
  AUTH_COOKIE_SAMESITE: 'lax' as const,
  AUTH_TOKEN_TTL_SECONDS: 86400,
}

async function cookieFor(claims: AuthTokenClaims): Promise<string> {
  const token = await signToken(claims)
  return `${AUTH_COOKIE_NAME}=${token}`
}

export function adminCookie(over: Partial<AuthTokenClaims> = {}): Promise<string> {
  return cookieFor({ sub: 'u-admin', login: 'admin', role: 'admin', pwdChangedAt: 0, ...over })
}

export function employeeCookie(over: Partial<AuthTokenClaims> = {}): Promise<string> {
  return cookieFor({ sub: 'u-emp', login: 'emp', role: 'employee', pwdChangedAt: 0, ...over })
}
