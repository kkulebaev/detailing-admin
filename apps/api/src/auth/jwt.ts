import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'
import type { Role } from '@detailing-admin/shared'
import { env } from '../env.js'

export interface AuthTokenClaims {
  sub: string
  login: string
  role: Role
  // Carried in the token so /me stays DB-free (the whole session is stateless);
  // re-minted on profile edit so the change shows without a re-login.
  firstName: string
  lastName: string
  // Unix seconds of the account's last password change. Carried now so a future
  // revocation path can reject tokens minted before a password reset without a
  // token-format migration (auth plan §3, Option C).
  pwdChangedAt: number
  // "Запомнить меня" chosen at login. Carried in the token so sliding refresh
  // (/me) and re-mints (profile/password change) preserve the session lifetime
  // instead of silently downgrading a long session to the default TTL.
  remember: boolean
}

type SignedPayload = AuthTokenClaims & JWTPayload & { exp: number; iat: number }

/** Session lifetime in seconds implied by the "remember me" choice. */
export function ttlForRemember(remember: boolean): number {
  return remember ? env.AUTH_REMEMBER_TTL_SECONDS : env.AUTH_TOKEN_TTL_SECONDS
}

export async function signToken(claims: AuthTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: SignedPayload = {
    ...claims,
    iat: now,
    exp: now + ttlForRemember(claims.remember),
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
      // Tokens minted before name claims existed lack these — default to '' so
      // an in-flight session survives the deploy instead of being force-logged-out.
      firstName: typeof payload.firstName === 'string' ? payload.firstName : '',
      lastName: typeof payload.lastName === 'string' ? payload.lastName : '',
      pwdChangedAt: payload.pwdChangedAt,
      // Tokens minted before this claim existed lack it — treat as "not
      // remembered" (default TTL), the safe/short-lived default.
      remember: payload.remember === true,
    }
  } catch {
    // Expired / bad signature / malformed — all collapse to "no session".
    return null
  }
}
