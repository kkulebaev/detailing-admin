import { describe, it, expect } from 'vitest'
import { bookingToRow, EXPECTED_HEADERS } from '../src/sheet-row.js'
import { bookingSchema } from '../src/booking.js'
import type { Booking } from '../src/booking.js'

function parseBooking(input: Record<string, unknown>): Booking {
  const result = bookingSchema.safeParse(input)
  if (!result.success) throw new Error('Parse failed: ' + JSON.stringify(result.error.issues))
  return result.data
}

const baseInput = {
  dateFrom: '04.06.2026',
  time: '10:00',
}

describe('EXPECTED_HEADERS', () => {
  it('has exactly 11 headers', () => {
    expect(EXPECTED_HEADERS.length).toBe(11)
  })

  it('column K (index 10) preserves the intentional typo Ответсвенный', () => {
    expect(EXPECTED_HEADERS[10]).toBe('Ответсвенный')
  })
})

describe('bookingToRow', () => {
  it('produces exactly 11 cells', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row).toHaveLength(11)
  })

  it('single-day: cell A is bare DD.MM.YYYY (no apostrophe)', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[0]).toBe('04.06.2026')
    expect(String(row[0]).startsWith("'")).toBe(false)
  })

  it('multi-day: cell A starts with apostrophe followed by the range', () => {
    const booking = parseBooking({ ...baseInput, dateTo: '05.06.2026' })
    const row = bookingToRow(booking)
    expect(typeof row[0]).toBe('string')
    expect(String(row[0])).toBe("'04.06.2026-05.06.2026")
  })

  it('undefined readiness → empty string in cell I', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[8]).toBe('')
  })

  it('undefined responsible → empty string in cell K', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[10]).toBe('')
  })

  it('amount empty string → empty cell H', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, amount: '' }))
    expect(row[7]).toBe('')
  })

  it('amount 200000 → numeric 200000 in cell H', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, amount: 200000 }))
    expect(row[7]).toBe(200000)
    expect(typeof row[7]).toBe('number')
  })
})
