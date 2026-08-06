import { describe, it, expect } from 'vitest'
import { carInputSchema, clientDetailOkSchema, clientInputSchema } from '../src/client.js'

describe('carInputSchema', () => {
  it('requires a non-empty make/model', () => {
    const r = carInputSchema.safeParse({ makeModel: '   ', plate: 'А123АА77' })
    expect(r.success).toBe(false)
  })

  it('trims make/model and plate', () => {
    const r = carInputSchema.parse({ makeModel: '  Toyota Camry  ', plate: '  А123АА77  ' })
    expect(r).toEqual({ makeModel: 'Toyota Camry', plate: 'А123АА77' })
  })

  it('defaults plate to an empty string when omitted', () => {
    const r = carInputSchema.parse({ makeModel: 'BMW X5' })
    expect(r).toEqual({ makeModel: 'BMW X5', plate: '' })
  })
})

describe('clientInputSchema', () => {
  it('passes cars through the transform', () => {
    const r = clientInputSchema.parse({
      name: '  Иван  ',
      phone: '+79001234567',
      cars: [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }],
    })
    expect(r).toEqual({
      name: 'Иван',
      phone: '+79001234567',
      cars: [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }],
    })
  })

  it('defaults cars to [] when the field is absent', () => {
    const r = clientInputSchema.parse({ name: 'Иван', phone: '+79001234567' })
    expect(r.cars).toEqual([])
  })

  it('still rejects an empty phone', () => {
    const r = clientInputSchema.safeParse({ name: 'Иван', phone: '', cars: [] })
    expect(r.success).toBe(false)
  })
})

describe('clientDetailOkSchema', () => {
  const validClient = {
    id: '11111111-1111-4111-8111-111111111111',
    phone: '+79001234567',
    name: 'Иван',
    createdAt: '2026-06-01T12:00:00.000Z',
    cars: [{ id: '22222222-2222-4222-8222-222222222222', makeModel: 'Toyota Camry', plate: 'А123АА77' }],
  }
  const validBooking = {
    id: '33333333-3333-4333-8333-333333333333',
    clientId: '11111111-1111-4111-8111-111111111111',
    name: 'Иван',
    phone: '+79001234567',
    car: 'Toyota Camry А123АА77',
    service: 'Мойка',
    note: '',
    amount: 5000,
    amountFormula: null,
    dateFrom: '2026-06-10',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: 'Выдана',
    master: ['Пётр'],
    responsible: 'Пётр',
    carClass: 2,
    sheetRow: 42,
    sheetRange: "'Запись 2026'!A42",
    createdAt: '2026-06-09T08:00:00.000Z',
  }

  it('accepts a valid detail payload', () => {
    const r = clientDetailOkSchema.safeParse({
      ok: true,
      client: validClient,
      stats: { totalSpent: 5000, visitCount: 1, lastVisit: '2026-06-10', firstVisit: '2026-06-10' },
      bookings: [validBooking],
      bookingsTruncated: false,
    })
    expect(r.success).toBe(true)
  })

  it('accepts null lastVisit/firstVisit for a client with no delivered visits', () => {
    const r = clientDetailOkSchema.safeParse({
      ok: true,
      client: validClient,
      stats: { totalSpent: 0, visitCount: 0, lastVisit: null, firstVisit: null },
      bookings: [],
      bookingsTruncated: false,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a payload missing stats', () => {
    const r = clientDetailOkSchema.safeParse({
      ok: true,
      client: validClient,
      bookings: [],
      bookingsTruncated: false,
    })
    expect(r.success).toBe(false)
  })
})
