import { describe, it, expect } from 'vitest'
import { sign } from 'hono/jwt'
import { signToken, verifyToken } from '../src/auth/jwt.js'

// Matches JWT_SECRET seeded in test/setup.ts (the real env module is used here).
const SECRET = 'test-jwt-secret-at-least-32-chars-long'

const CLAIMS = { sub: 'u-1', login: 'admin', role: 'admin' as const, pwdChangedAt: 1700000000 }

describe('jwt', () => {
  it('sign → verify roundtrips and preserves claims', async () => {
    const token = await signToken(CLAIMS)
    const decoded = await verifyToken(token)
    expect(decoded).toEqual(CLAIMS)
  })

  it('carries pwdChangedAt in the payload', async () => {
    const token = await signToken({ ...CLAIMS, pwdChangedAt: 42 })
    const decoded = await verifyToken(token)
    expect(decoded?.pwdChangedAt).toBe(42)
  })

  it('rejects a token signed with a different secret', async () => {
    const now = Math.floor(Date.now() / 1000)
    const foreign = await sign(
      { ...CLAIMS, iat: now, exp: now + 3600 },
      'another-secret-that-is-also-32-chars-long',
      'HS256',
    )
    expect(await verifyToken(foreign)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const expired = await sign({ ...CLAIMS, iat: past - 3600, exp: past }, SECRET, 'HS256')
    expect(await verifyToken(expired)).toBeNull()
  })

  it('rejects a malformed token', async () => {
    expect(await verifyToken('not.a.jwt')).toBeNull()
    expect(await verifyToken('')).toBeNull()
  })

  it('rejects a token missing required claims', async () => {
    const now = Math.floor(Date.now() / 1000)
    const partial = await sign({ sub: 'u-1', iat: now, exp: now + 3600 }, SECRET, 'HS256')
    expect(await verifyToken(partial)).toBeNull()
  })
})
