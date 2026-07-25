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
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  amount: 5000,
  master: 'Иван Содель',
  responsible: 'Иван Содель',
  carClass: 3,
}

describe('EXPECTED_HEADERS', () => {
  it('has exactly 11 headers', () => {
    expect(EXPECTED_HEADERS.length).toBe(11)
  })

  it('column K (index 10) is Ответственный', () => {
    expect(EXPECTED_HEADERS[10]).toBe('Ответственный')
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

  it('multi-day without end time: cell A is "\'start time-end" with time only on start', () => {
    const booking = parseBooking({ ...baseInput, dateTo: '05.06.2026' })
    const row = bookingToRow(booking)
    expect(typeof row[0]).toBe('string')
    expect(String(row[0])).toBe("'04.06.2026 10:00-05.06.2026")
  })

  it('multi-day with end time: cell A includes both start and end times', () => {
    const booking = parseBooking({ ...baseInput, dateTo: '05.06.2026', timeTo: '18:30' })
    const row = bookingToRow(booking)
    expect(String(row[0])).toBe("'04.06.2026 10:00-05.06.2026 18:30")
  })

  it('cell D: phone is apostrophe-forced TEXT in the domestic 8XXXXXXXXXX form', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[3]).toBe("'89991234567")
  })

  it('undefined readiness → empty string in cell I', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[8]).toBe('')
  })

  it('responsible from base input is written to cell K', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[10]).toBe('Иван Содель')
  })

  it('amount 200000 → numeric 200000 in cell H', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, amount: 200000 }))
    expect(row[7]).toBe(200000)
    expect(typeof row[7]).toBe('number')
  })

  it('amountFormula → written verbatim to cell H instead of the number', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, amount: 5050, amountFormula: '=2000+3000-950' }))
    expect(row[7]).toBe('=2000+3000-950')
  })

  it('rejects an amountFormula containing a non-arithmetic Sheets function', () => {
    const result = bookingSchema.safeParse({ ...baseInput, amountFormula: '=IMPORTRANGE("x","y")' })
    expect(result.success).toBe(false)
  })
})
