import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env } from '../env.js'

export const AUTH_COOKIE_NAME = 'auth_token'

function sameSite() {
  return env.AUTH_COOKIE_SAMESITE === 'none' ? ('None' as const) : ('Lax' as const)
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: sameSite(),
    path: '/',
    maxAge: env.AUTH_TOKEN_TTL_SECONDS,
  }
}

export function setAuthCookie(c: Context, token: string): void {
  setCookie(c, AUTH_COOKIE_NAME, token, cookieOptions())
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
