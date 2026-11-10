import { describe, expect, it } from 'vitest'
import { diffBookings } from '../src/db/audit.js'
import type { Booking } from '../src/db/schema.js'

const BASE: Booking = {
  id: 'bk1',
  idempotencyKey: 'k1',
  clientId: 'c1',
  name: 'Иван',
  phone: '+79001234567',
  car: 'Toyota',
  service: 'Мойка',
  note: '',
  amount: 5000,
  amountFormula: null,
  dateFrom: '2026-06-04',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  readiness: '',
  master: ['Мастер А'],
  responsible: 'Мастер А',
  responsibleId: 1,
  carId: null,
  carClass: 2,
  sheetRow: 2,
  sheetRange: 'x',
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
}

describe('diffBookings', () => {
  it('пустой, если ничего не поменялось (массив мастеров сравнивается по значению)', () => {
    expect(diffBookings(BASE, { ...BASE, master: ['Мастер А'] })).toEqual([])
  })

  it('пишет только изменившиеся поля в порядке BOOKING_AUDITED_FIELDS', () => {
    expect(
      diffBookings(BASE, { ...BASE, readiness: 'Выдана', amount: 7000, dateTo: '2026-06-05' }),
    ).toEqual([
      { field: 'amount', from: 5000, to: 7000 },
      { field: 'dateTo', from: null, to: '2026-06-05' },
      { field: 'readiness', from: '', to: 'Выдана' },
    ])
  })

  it('ловит смену состава и порядка мастеров', () => {
    expect(diffBookings(BASE, { ...BASE, master: ['Мастер Б', 'Мастер А'] })).toEqual([
      { field: 'master', from: ['Мастер А'], to: ['Мастер Б', 'Мастер А'] },
    ])
  })

  it('не пишет производные связи', () => {
    expect(diffBookings(BASE, { ...BASE, clientId: null, carId: 'car', responsibleId: 9 })).toEqual(
      [],
    )
  })
})
