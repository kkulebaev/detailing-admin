import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../src/phone.js'

describe('normalizePhone', () => {
  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('')
  })

  it('normalizes 8-prefixed spaced number', () => {
    expect(normalizePhone('8 999 123 45 67')).toBe('+79991234567')
  })

  it('normalizes +7 formatted with parentheses and dashes', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567')
  })

  it('normalizes 7-prefixed number with dashes', () => {
    expect(normalizePhone('7-999-123-45-67')).toBe('+79991234567')
  })

  it('normalizes compact 11-digit 8-prefixed number', () => {
    expect(normalizePhone('89991234567')).toBe('+79991234567')
  })

  it('throws on too-short number', () => {
    expect(() => normalizePhone('123')).toThrow()
  })

  it('throws on +8-prefixed number', () => {
    expect(() => normalizePhone('+8 999 1234567890')).toThrow()
  })

  it('throws on +7 with too few digits', () => {
    // +7 followed by only 7 digits, not 10
    expect(() => normalizePhone('+7 999 1234')).toThrow()
  })

  it('throws on 10-digit no-prefix number', () => {
    expect(() => normalizePhone('9991234567')).toThrow()
  })
})
