import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env } from '../env.js'

export const AUTH_COOKIE_NAME = 'auth_token'

function sameSite() {
  return env.AUTH_COOKIE_SAMESITE === 'none' ? ('None' as const) : ('Lax' as const)
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: sameSite(),
    path: '/',
    // Must match the token's exp so the browser drops the cookie exactly when
    // the JWT expires — the caller derives both from ttlForRemember().
    maxAge: maxAgeSeconds,
  }
}

export function setAuthCookie(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, AUTH_COOKIE_NAME, token, cookieOptions(maxAgeSeconds))
}

export function clearAuthCookie(c: Context): void {
  // Mirror secure/sameSite from set: under a SameSite=None deploy the browser
  // only honours the deletion if its attributes match the original cookie.
  deleteCookie(c, AUTH_COOKIE_NAME, {
    path: '/',
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: sameSite(),
  })
}

export function getAuthToken(c: Context): string | undefined {
  return getCookie(c, AUTH_COOKIE_NAME)
}
