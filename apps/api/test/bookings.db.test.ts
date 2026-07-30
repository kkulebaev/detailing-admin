import { describe, it, expect, vi } from 'vitest'

// The mapper under test is pure, but importing db/bookings.js pulls db/client.js
// → env.js. Stub the client so the env chain never loads.
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

import { bookingSchema } from '@detailing-admin/shared/booking'
import { bookingToDbRow } from '../src/db/bookings.js'

function makeBooking(over: Record<string, unknown> = {}) {
  return bookingSchema.parse({
    dateFrom: '04.06.2026',
    time: '10:00',
    name: 'Иван',
    phone: '8 (900) 123-45-67',
    car: 'Toyota Camry',
    service: 'Полировка',
    amount: 5000,
    master: 'Мастер А',
    responsible: 'Мастер Б',
    carClass: 3,
    ...over,
  })
}

const META = {
  idempotencyKey: 'k1',
  clientId: 'c1' as string | null,
  sheetRow: 5 as number | null,
  sheetRange: 'Запись 2026!A5' as string | null,
}

describe('bookingToDbRow', () => {
  it('maps a single-day booking with ISO dates and an E.164 phone snapshot', () => {
    const row = bookingToDbRow(makeBooking(), META)
    expect(row).toMatchObject({
      idempotencyKey: 'k1',
      clientId: 'c1',
      name: 'Иван',
      phone: '+79001234567',
      car: 'Toyota Camry',
      service: 'Полировка',
      amount: 5000,
      amountFormula: null,
      dateFrom: '2026-06-04',
      dateTo: null,
      timeFrom: '10:00',
      timeTo: null,
      carClass: 3,
      sheetRow: 5,
      sheetRange: 'Запись 2026!A5',
    })
  })

  it('keeps dateTo/timeTo and the amount formula for a multi-day booking', () => {
    const row = bookingToDbRow(
      makeBooking({ dateTo: '06.06.2026', timeTo: '18:00', amountFormula: '=2000+3000' }),
      META,
    )
    expect(row.dateFrom).toBe('2026-06-04')
    expect(row.dateTo).toBe('2026-06-06')
    expect(row.timeFrom).toBe('10:00')
    expect(row.timeTo).toBe('18:00')
    expect(row.amountFormula).toBe('=2000+3000')
  })

  it('carries a null client link through and defaults note to empty', () => {
    const row = bookingToDbRow(makeBooking(), { ...META, clientId: null })
    expect(row.clientId).toBeNull()
    expect(row.note).toBe('')
  })
})
