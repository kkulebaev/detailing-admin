import { describe, it, expect } from 'vitest'
import { formatAmount, formatSigned } from '@/lib/money'

// The sign is the whole point of the payout columns: a hyphen instead of U+2212
// reads as a dash next to tabular digits, and a missing "+" makes a bonus look
// like a plain number. Both are pinned here.
describe('formatSigned', () => {
  it('prefixes a positive amount with + and groups digits', () => {
    expect(formatSigned(5000)).toBe('+5 000')
  })

  it('prefixes a negative amount with U+2212 MINUS SIGN, not a hyphen', () => {
    expect(formatSigned(-2000)).toBe('−2 000')
    expect(formatSigned(-2000)).not.toContain('-')
  })

  it('leaves zero unsigned', () => {
    expect(formatSigned(0)).toBe('0')
  })

  it('groups long amounts by thousands', () => {
    expect(formatSigned(1234567)).toBe('+1 234 567')
    expect(formatSigned(-1234567)).toBe('−1 234 567')
  })

  it('does not group amounts under a thousand', () => {
    expect(formatSigned(999)).toBe('+999')
  })
})

// «Разовые ₽» and «Итого ₽» sit next to each other in one row, so both minus
// glyphs have to be the same character — a hyphen here and U+2212 there reads
// as two different kinds of number.
describe('formatAmount', () => {
  it('groups digits by thousands without a sign', () => {
    expect(formatAmount(5000)).toBe('5 000')
    expect(formatAmount(1234567)).toBe('1 234 567')
  })

  it('renders a negative amount with U+2212 MINUS SIGN, not a hyphen', () => {
    expect(formatAmount(-1900)).toBe('−1 900')
    expect(formatAmount(-1900)).not.toContain('-')
  })

  it('never prefixes a positive amount with + (it is not a signed column)', () => {
    expect(formatAmount(999)).toBe('999')
    expect(formatAmount(0)).toBe('0')
  })

  it('uses the same minus glyph as formatSigned', () => {
    expect(formatAmount(-2000).slice(0, 1)).toBe(formatSigned(-2000).slice(0, 1))
  })
})
