import { describe, it, expect } from 'vitest'
import { sign } from 'hono/jwt'
import { signToken, verifyToken } from '../src/auth/jwt.js'

// Matches JWT_SECRET seeded in test/setup.ts (the real env module is used here).
const SECRET = 'test-jwt-secret-at-least-32-chars-long'

// Reads the `exp` claim out of a signed JWT without verifying — enough to
// assert the TTL the token was minted with.
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

  it('carries the remember flag and uses a longer exp when set', async () => {
    const now = Math.floor(Date.now() / 1000)
    // Default TTL 86400s vs remember TTL 2592000s (env defaults).
    expect(decodeExp(await signToken({ ...CLAIMS, remember: false }))).toBeLessThan(now + 86400 + 5)
    expect(decodeExp(await signToken({ ...CLAIMS, remember: true }))).toBeGreaterThan(now + 86400 * 7)

    const decoded = await verifyToken(await signToken({ ...CLAIMS, remember: true }))
    expect(decoded?.remember).toBe(true)
  })

  it('defaults remember to false on tokens minted before the claim existed', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { remember: _omit, ...legacyClaims } = CLAIMS
    const legacy = await sign({ ...legacyClaims, iat: now, exp: now + 3600 }, SECRET, 'HS256')
    const decoded = await verifyToken(legacy)
    expect(decoded?.remember).toBe(false)
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

  it('defaults name claims to empty on tokens minted before they existed', async () => {
    const now = Math.floor(Date.now() / 1000)
    const legacy = await sign(
      { sub: 'u-1', login: 'admin', role: 'admin', pwdChangedAt: 1, iat: now, exp: now + 3600 },
      SECRET,
      'HS256',
    )
    const decoded = await verifyToken(legacy)
    expect(decoded).toMatchObject({ firstName: '', lastName: '' })
  })

  it('rejects a token missing required claims', async () => {
    const now = Math.floor(Date.now() / 1000)
    const partial = await sign({ sub: 'u-1', iat: now, exp: now + 3600 }, SECRET, 'HS256')
    expect(await verifyToken(partial)).toBeNull()
  })
})
