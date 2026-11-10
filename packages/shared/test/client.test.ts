import { describe, it, expect } from 'vitest'
import { carInputSchema, clientDetailOkSchema, clientInputSchema } from '../src/client.js'

describe('carInputSchema', () => {
  it('требует непустую марку/модель', () => {
    const r = carInputSchema.safeParse({ makeModel: '   ', plate: 'А123АА77' })
    expect(r.success).toBe(false)
  })

  it('обрезает пробелы у марки/модели и номера', () => {
    const r = carInputSchema.parse({ makeModel: '  Toyota Camry  ', plate: '  А123АА77  ' })
    expect(r).toEqual({ makeModel: 'Toyota Camry', plate: 'А123АА77' })
  })

  it('по умолчанию номер — пустая строка, если не передан', () => {
    const r = carInputSchema.parse({ makeModel: 'BMW X5' })
    expect(r).toEqual({ makeModel: 'BMW X5', plate: '' })
  })
})

describe('clientInputSchema', () => {
  it('пропускает cars через transform', () => {
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

  it('по умолчанию cars — [], если поля нет', () => {
    const r = clientInputSchema.parse({ name: 'Иван', phone: '+79001234567' })
    expect(r.cars).toEqual([])
  })

  it('по-прежнему отклоняет пустой телефон', () => {
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
    cars: [
      { id: '22222222-2222-4222-8222-222222222222', makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ],
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
    master: ['Петр'],
    responsible: 'Петр',
    carClass: 2,
    sheetRow: 42,
    sheetRange: "'Запись 2026'!A42",
    createdAt: '2026-06-09T08:00:00.000Z',
  }

  it('принимает валидный payload карточки', () => {
    const r = clientDetailOkSchema.safeParse({
      ok: true,
      client: validClient,
      stats: { totalSpent: 5000, visitCount: 1, lastVisit: '2026-06-10', firstVisit: '2026-06-10' },
      bookings: [validBooking],
      bookingsTruncated: false,
    })
    expect(r.success).toBe(true)
  })

  it('принимает null в lastVisit/firstVisit для клиента без выданных визитов', () => {
    const r = clientDetailOkSchema.safeParse({
      ok: true,
      client: validClient,
      stats: { totalSpent: 0, visitCount: 0, lastVisit: null, firstVisit: null },
      bookings: [],
      bookingsTruncated: false,
    })
    expect(r.success).toBe(true)
  })

  it('отклоняет payload без stats', () => {
    const r = clientDetailOkSchema.safeParse({
      ok: true,
      client: validClient,
      bookings: [],
      bookingsTruncated: false,
    })
    expect(r.success).toBe(false)
  })
})
