import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../src/phone.js'

describe('normalizePhone', () => {
  it('возвращает пустую строку на пустой ввод', () => {
    expect(normalizePhone('')).toBe('')
  })

  it('нормализует номер с 8 в начале и пробелами', () => {
    expect(normalizePhone('8 999 123 45 67')).toBe('+79991234567')
  })

  it('нормализует +7 со скобками и дефисами', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567')
  })

  it('нормализует номер с 7 в начале и дефисами', () => {
    expect(normalizePhone('7-999-123-45-67')).toBe('+79991234567')
  })

  it('нормализует слитный 11-значный номер с 8 в начале', () => {
    expect(normalizePhone('89991234567')).toBe('+79991234567')
  })

  it('бросает ошибку на слишком коротком номере', () => {
    expect(() => normalizePhone('123')).toThrow()
  })

  it('бросает ошибку на номере с +8 в начале', () => {
    expect(() => normalizePhone('+8 999 1234567890')).toThrow()
  })

  it('бросает ошибку на +7 со слишком малым числом цифр', () => {
    // после +7 только 7 цифр, а не 10
    expect(() => normalizePhone('+7 999 1234')).toThrow()
  })

  it('бросает ошибку на 10-значном номере без префикса', () => {
    expect(() => normalizePhone('9991234567')).toThrow()
  })
})
