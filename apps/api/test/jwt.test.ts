import { describe, it, expect } from 'vitest'
import { sign } from 'hono/jwt'
import { signToken, verifyToken } from '../src/auth/jwt.js'

// Совпадает с JWT_SECRET из test/setup.ts (здесь используется настоящий модуль env).
const SECRET = 'test-jwt-secret-at-least-32-chars-long'

// Достаёт claim `exp` из подписанного JWT без проверки подписи — этого хватает,
// чтобы проверить TTL, с которым выпущен токен.
function decodeExp(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  return payload.exp as number
}

const CLAIMS = {
  sub: 'u-1',
  login: 'admin',
  role: 'admin' as const,
  firstName: 'Иван',
  lastName: 'Петров',
  pwdChangedAt: 1700000000,
  remember: false,
}

describe('jwt', () => {
  it('sign → verify проходит туда и обратно и сохраняет claims', async () => {
    const token = await signToken(CLAIMS)
    const decoded = await verifyToken(token)
    expect(decoded).toEqual(CLAIMS)
  })

  it('передаёт pwdChangedAt в payload', async () => {
    const token = await signToken({ ...CLAIMS, pwdChangedAt: 42 })
    const decoded = await verifyToken(token)
    expect(decoded?.pwdChangedAt).toBe(42)
  })

  it('передаёт флаг remember и при нём ставит более долгий exp', async () => {
    const now = Math.floor(Date.now() / 1000)
    // TTL по умолчанию 86400 с против 2592000 с для remember (дефолты env).
    expect(decodeExp(await signToken({ ...CLAIMS, remember: false }))).toBeLessThan(now + 86400 + 5)
    expect(decodeExp(await signToken({ ...CLAIMS, remember: true }))).toBeGreaterThan(
      now + 86400 * 7,
    )

    const decoded = await verifyToken(await signToken({ ...CLAIMS, remember: true }))
    expect(decoded?.remember).toBe(true)
  })

  it('считает remember равным false у токенов, выпущенных до появления этого claim', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { remember: _omit, ...legacyClaims } = CLAIMS
    const legacy = await sign({ ...legacyClaims, iat: now, exp: now + 3600 }, SECRET, 'HS256')
    const decoded = await verifyToken(legacy)
    expect(decoded?.remember).toBe(false)
  })

  it('сохраняет роль booker и отклоняет неизвестную роль', async () => {
    const decoded = await verifyToken(await signToken({ ...CLAIMS, role: 'booker' }))
    expect(decoded?.role).toBe('booker')

    const now = Math.floor(Date.now() / 1000)
    const forged = await sign(
      { ...CLAIMS, role: 'root', iat: now, exp: now + 3600 },
      SECRET,
      'HS256',
    )
    expect(await verifyToken(forged)).toBeNull()
  })

  it('отклоняет токен, подписанный другим секретом', async () => {
    const now = Math.floor(Date.now() / 1000)
    const foreign = await sign(
      { ...CLAIMS, iat: now, exp: now + 3600 },
      'another-secret-that-is-also-32-chars-long',
      'HS256',
    )
    expect(await verifyToken(foreign)).toBeNull()
  })

  it('отклоняет просроченный токен', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const expired = await sign({ ...CLAIMS, iat: past - 3600, exp: past }, SECRET, 'HS256')
    expect(await verifyToken(expired)).toBeNull()
  })

  it('отклоняет испорченный токен', async () => {
    expect(await verifyToken('not.a.jwt')).toBeNull()
    expect(await verifyToken('')).toBeNull()
  })

  it('считает claims с именем пустыми у токенов, выпущенных до их появления', async () => {
    const now = Math.floor(Date.now() / 1000)
    const legacy = await sign(
      { sub: 'u-1', login: 'admin', role: 'admin', pwdChangedAt: 1, iat: now, exp: now + 3600 },
      SECRET,
      'HS256',
    )
    const decoded = await verifyToken(legacy)
    expect(decoded).toMatchObject({ firstName: '', lastName: '' })
  })

  it('отклоняет токен без обязательных claims', async () => {
    const now = Math.floor(Date.now() / 1000)
    const partial = await sign({ sub: 'u-1', iat: now, exp: now + 3600 }, SECRET, 'HS256')
    expect(await verifyToken(partial)).toBeNull()
  })
})
