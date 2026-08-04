import { describe, it, expect, vi } from 'vitest'

// The mapper under test is pure, but importing db/bookings.js pulls db/client.js
// → env.js. Stub the client so the env chain never loads.
vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

import { PgDialect } from 'drizzle-orm/pg-core'
import { bookingSchema } from '@detailing-admin/shared/booking'
import { bookingToDbRow, listBookings } from '../src/db/bookings.js'
import { getDb } from '../src/db/client.js'

function makeBooking(over: Record<string, unknown> = {}) {
  return bookingSchema.parse({
    dateFrom: '04.06.2026',
    time: '10:00',
    name: 'Иван',
    phone: '8 (900) 123-45-67',
    car: 'Toyota Camry',
    service: 'Полировка',
    amount: 5000,
    master: ['Мастер А'],
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

describe('listBookings master filter', () => {
  // A thenable query-builder stub: every chain method returns `this`, and the
  // whole object resolves to [] when awaited — so both the items query
  // (…offset() then await) and the count query (await …where()) work without a
  // real DB. Each `.where()` call records its condition for inspection.
  function fakeDb(captured: unknown[]) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      where: (w: unknown) => {
        captured.push(w)
        return chain
      },
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      then: (resolve: (v: unknown[]) => unknown) => resolve([]),
    }
    return chain
  }

  it('filters a single master via `= ANY(master)` membership, not equality', async () => {
    const captured: unknown[] = []
    vi.mocked(getDb).mockReturnValue(fakeDb(captured) as never)

    await listBookings({ limit: 10, offset: 0, master: 'Пётр' })

    expect(captured.length).toBeGreaterThan(0)
    const rendered = new PgDialect().sqlToQuery(captured[0] as never)
    expect(rendered.sql).toContain('= ANY')
    expect(rendered.sql).toContain('"master"')
    expect(rendered.params).toContain('Пётр')
  })

  it('builds no where clause when no filters are given', async () => {
    const captured: unknown[] = []
    vi.mocked(getDb).mockReturnValue(fakeDb(captured) as never)

    await listBookings({ limit: 10, offset: 0 })

    // undefined where → the stub still gets called with undefined.
    expect(captured[0]).toBeUndefined()
  })
})
