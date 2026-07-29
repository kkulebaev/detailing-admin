import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'
import type { Role } from '@detailing-admin/shared'
import { env } from '../env.js'

export interface AuthTokenClaims {
  sub: string
  login: string
  role: Role
  // Unix seconds of the account's last password change. Carried now so a future
  // revocation path can reject tokens minted before a password reset without a
  // token-format migration (auth plan §3, Option C).
  pwdChangedAt: number
}

type SignedPayload = AuthTokenClaims & JWTPayload & { exp: number; iat: number }

export async function signToken(claims: AuthTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SignedPayload = {
    ...claims,
    iat: now,
    exp: now + env.AUTH_TOKEN_TTL_SECONDS,
  }
  return sign(payload, env.JWT_SECRET, 'HS256')
}

/** Returns the claims on a valid, unexpired token; `null` on any failure. */
export async function verifyToken(token: string): Promise<AuthTokenClaims | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256')
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.login !== 'string' ||
      (payload.role !== 'admin' && payload.role !== 'employee') ||
      typeof payload.pwdChangedAt !== 'number'
    ) {
      return null
    }
    return {
      sub: payload.sub,
      login: payload.login,
      role: payload.role,
      pwdChangedAt: payload.pwdChangedAt,
    }
  } catch {
    // Expired / bad signature / malformed — all collapse to "no session".
    return null
  }
}
