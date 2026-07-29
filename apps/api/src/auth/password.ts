import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Hand-rolled promise wrapper rather than promisify(): promisify only picks
// scrypt's 3-arg overload and drops the `options` (N/r/p) parameter.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })
}

// Lower bound for 2026. Parameters are stored inline in the hash so a future
// bump still verifies old hashes (each hash carries the N/r/p it was made with).
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64
const SALT_BYTES = 16

// N=16384,r=8,p=1 needs ~16 MB; the Node default maxmem (32 MB) covers it, but
// pass it explicitly so a future parameter bump doesn't silently start throwing.
const MAXMEM = 64 * 1024 * 1024

async function derive(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return scrypt(password, salt, keylen, { N, r: R, p: P, maxmem: MAXMEM })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await derive(password, salt, KEYLEN)
  return `scrypt:${N}:${R}:${P}:${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts
  const n = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  // Derive to the stored hash's length so timingSafeEqual gets equal-length
  // buffers (it throws on a length mismatch) and old hashes with a different
  // keylen still verify.
  const actual = await scrypt(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

// Constant-time filler for the "login not found" path: run a real scrypt against
// a throwaway hash so an attacker can't distinguish a missing account from a
// wrong password by response timing (see auth plan §5).
const DUMMY_HASH = `scrypt:${N}:${R}:${P}:${'0'.repeat(SALT_BYTES * 2)}:${'0'.repeat(KEYLEN * 2)}`

export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH)
}
