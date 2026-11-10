// Общие хелперы для route-тестов, которым нужно пройти auth-гарды.
//
// Поля auth-env ниже должны также присутствовать в фабрике `vi.mock('../src/env.js')`
// каждого тестового файла (из поднятой фабрики на них нельзя сослаться, поэтому
// там они продублированы); этот объект документирует их форму.
import { signToken, type AuthTokenClaims } from '../src/auth/jwt.js'
import { AUTH_COOKIE_NAME } from '../src/auth/cookie.js'

export const AUTH_ENV = {
  JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
  AUTH_COOKIE_SECURE: false,
  AUTH_COOKIE_SAMESITE: 'lax' as const,
  AUTH_TOKEN_TTL_SECONDS: 86400,
  AUTH_REMEMBER_TTL_SECONDS: 2592000,
}

async function cookieFor(claims: AuthTokenClaims): Promise<string> {
  const token = await signToken(claims)
  return `${AUTH_COOKIE_NAME}=${token}`
}

export function adminCookie(over: Partial<AuthTokenClaims> = {}): Promise<string> {
  return cookieFor({
    sub: 'u-admin',
    login: 'admin',
    role: 'admin',
    firstName: '',
    lastName: '',
    pwdChangedAt: 0,
    remember: false,
    ...over,
  })
}

export function bookerCookie(over: Partial<AuthTokenClaims> = {}): Promise<string> {
  return cookieFor({
    sub: 'u-booker',
    login: 'booker',
    role: 'booker',
    firstName: '',
    lastName: '',
    pwdChangedAt: 0,
    remember: false,
    ...over,
  })
}

export function employeeCookie(over: Partial<AuthTokenClaims> = {}): Promise<string> {
  return cookieFor({
    sub: 'u-emp',
    login: 'emp',
    role: 'employee',
    firstName: '',
    lastName: '',
    pwdChangedAt: 0,
    remember: false,
    ...over,
  })
}
