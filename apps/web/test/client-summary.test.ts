import { describe, it, expect } from 'vitest'
import type { BookingRow } from '@detailing-admin/shared'
import { lastDeliveredService } from '@/lib/client-summary'

function row(readiness: BookingRow['readiness'], service: string): BookingRow {
  return {
    id: crypto.randomUUID(),
    clientId: null,
    name: '',
    phone: '',
    car: '',
    service,
    note: '',
    dateFrom: '2026-09-12',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness,
    master: [],
    responsible: '',
    carClass: 1,
    sheetRow: null,
    sheetRange: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  }
}

describe('lastDeliveredService', () => {
  it('skips newer rows that were not delivered', () => {
    const history = [
      row('Подтвердил', 'Мойка'),
      row('Отмена', 'Химчистка'),
      row('Выдана', 'Полировка: кузов'),
      row('Выдана', 'Керамика'),
    ]
    expect(lastDeliveredService(history)).toBe('Полировка: кузов')
  })

  it('returns null when nothing was delivered', () => {
    expect(lastDeliveredService([row('Перенос', 'Мойка')])).toBeNull()
    expect(lastDeliveredService([])).toBeNull()
  })

  it('treats a blank service as missing', () => {
    expect(lastDeliveredService([row('Выдана', '  ')])).toBeNull()
  })
})
