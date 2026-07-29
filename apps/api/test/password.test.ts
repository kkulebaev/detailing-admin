import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, dummyVerify } from '../src/auth/password.js'

describe('password hashing', () => {
  it('hash → verify roundtrips', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt:16384:8:1:')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('right-password')
    expect(await verifyPassword('wrong-password', stored)).toBe(false)
  })

  it('produces a distinct salt (and hash) per call', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
    // But both still verify.
    expect(await verifyPassword('same', a)).toBe(true)
    expect(await verifyPassword('same', b)).toBe(true)
  })

  it('returns false (no throw) for a malformed stored string', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt:16384:8:1:onlyfour')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt:1:2:3:aa:bb')).toBe(false)
  })

  it('does not throw when derived and stored buffers differ in length', async () => {
    // Stored hashHex decodes to 2 bytes while a real derivation is 64 — the
    // length guard must return false rather than let timingSafeEqual throw.
    const malformed = `scrypt:16384:8:1:${'0'.repeat(32)}:abcd`
    await expect(verifyPassword('whatever', malformed)).resolves.toBe(false)
  })

  it('dummyVerify resolves without throwing', async () => {
    await expect(dummyVerify('anything')).resolves.toBeUndefined()
  })
})
