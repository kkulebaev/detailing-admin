import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, dummyVerify } from '../src/auth/password.js'

describe('хеширование паролей', () => {
  it('hash → verify проходит туда и обратно', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt:16384:8:1:')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('отклоняет неверный пароль', async () => {
    const stored = await hashPassword('right-password')
    expect(await verifyPassword('wrong-password', stored)).toBe(false)
  })

  it('выдаёт разную соль (и хеш) при каждом вызове', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
    // Но оба всё равно проходят проверку.
    expect(await verifyPassword('same', a)).toBe(true)
    expect(await verifyPassword('same', b)).toBe(true)
  })

  it('возвращает false (без исключения) для испорченной сохранённой строки', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt:16384:8:1:onlyfour')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt:1:2:3:aa:bb')).toBe(false)
  })

  it('не бросает, если вычисленный и сохранённый буферы разной длины', async () => {
    // Сохранённый hashHex декодируется в 2 байта, а реальное вычисление даёт 64 —
    // проверка длины должна вернуть false, а не дать timingSafeEqual бросить.
    const malformed = `scrypt:16384:8:1:${'0'.repeat(32)}:abcd`
    await expect(verifyPassword('whatever', malformed)).resolves.toBe(false)
  })

  it('dummyVerify завершается без исключения', async () => {
    await expect(dummyVerify('anything')).resolves.toBeUndefined()
  })
})
