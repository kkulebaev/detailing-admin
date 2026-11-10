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
    // Должно совпадать с exp токена, чтобы браузер выбросил cookie ровно тогда,
    // когда истекает JWT, — вызывающий код выводит оба значения из ttlForRemember().
    maxAge: maxAgeSeconds,
  }
}

export function setAuthCookie(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, AUTH_COOKIE_NAME, token, cookieOptions(maxAgeSeconds))
}

export function clearAuthCookie(c: Context): void {
  // Повторяем secure/sameSite из set: при деплое с SameSite=None браузер
  // выполняет удаление, только если атрибуты совпадают с исходной cookie.
  deleteCookie(c, AUTH_COOKIE_NAME, {
    path: '/',
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: sameSite(),
  })
}

export function getAuthToken(c: Context): string | undefined {
  return getCookie(c, AUTH_COOKIE_NAME)
}
