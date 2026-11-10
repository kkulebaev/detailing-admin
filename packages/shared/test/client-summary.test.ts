import { describe, it, expect } from 'vitest'
import { lastDeliveredService, missedBookings } from '../src/client-summary.js'

function row(readiness: string, service: string, dateFrom = '2026-09-12') {
  return { readiness, service, dateFrom }
}

describe('lastDeliveredService', () => {
  it('пропускает более свежие строки, которые не были выданы', () => {
    const history = [
      row('Подтвердил', 'Мойка'),
      row('Отмена', 'Химчистка'),
      row('Выдана', 'Полировка: кузов'),
      row('Выдана', 'Керамика'),
    ]
    expect(lastDeliveredService(history)).toBe('Полировка: кузов')
  })

  it('возвращает null, если ничего не выдано', () => {
    expect(lastDeliveredService([row('Перенос', 'Мойка')])).toBeNull()
    expect(lastDeliveredService([])).toBeNull()
  })

  it('считает пустую услугу отсутствующей', () => {
    expect(lastDeliveredService([row('Выдана', '  ')])).toBeNull()
  })
})

describe('missedBookings', () => {
  it('считает отмены и неявки раздельно, с датой самой свежей', () => {
    const history = [
      row('Подтвердил', 'Мойка', '2026-11-02'),
      row('Не приехал', 'Химчистка', '2026-10-01'),
      row('Отмена', 'Мойка', '2026-08-15'),
      row('Выдана', 'Керамика', '2026-07-01'),
      row('Отмена', 'Мойка', '2026-03-10'),
    ]
    expect(missedBookings(history)).toEqual({ cancelled: 2, noShow: 1, lastDate: '2026-10-01' })
  })

  it('не считает перенесённую запись', () => {
    expect(missedBookings([row('Перенос', 'Мойка'), row('Выдана', 'Мойка')])).toBeNull()
  })
})
