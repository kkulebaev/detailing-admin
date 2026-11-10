import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Промис-обертка написана руками, а не через promisify(): promisify берет только
// 3-аргументную перегрузку scrypt и теряет параметр `options` (N/r/p).
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

// Нижняя граница на 2026 год. Параметры хранятся прямо в хэше, поэтому после будущего
// повышения старые хэши все равно проверяются (каждый хэш несет свои N/r/p).
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64
const SALT_BYTES = 16

// N=16384,r=8,p=1 требует ~16 МБ; дефолтного maxmem в Node (32 МБ) хватает, но
// передаем его явно, чтобы будущее повышение параметров не начало молча бросать ошибки.
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
  // Выводим ключ длины сохраненного хэша, чтобы timingSafeEqual получил буферы
  // одинаковой длины (при несовпадении он бросает ошибку), а старые хэши с другим
  // keylen по-прежнему проверялись.
  const actual = await scrypt(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  })
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

// Заглушка постоянного времени для ветки «логин не найден»: запускаем настоящий scrypt
// против одноразового хэша, чтобы атакующий не отличил отсутствующий аккаунт от
// неверного пароля по времени ответа (см. план авторизации, §5).
const DUMMY_HASH = `scrypt:${N}:${R}:${P}:${'0'.repeat(SALT_BYTES * 2)}:${'0'.repeat(KEYLEN * 2)}`

export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH)
}
