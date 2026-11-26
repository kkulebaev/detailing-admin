import { describe, expect, it } from 'vitest'
import { describeDayBookings, formatDayList, weekdayName } from '@/lib/schedule-format'

describe('formatDayList', () => {
  it('сортирует дни и пишет месяц один раз после его чисел', () => {
    expect(formatDayList(['2026-12-05', '2027-01-02', '2026-12-03'])).toBe('3, 5 декабря, 2 января')
  })
})

describe('describeDayBookings', () => {
  it('склоняет число записей и пишет время с концом, если он есть', () => {
    const list = [
      { id: 'a', timeFrom: '10:00', timeTo: '12:00', car: 'Kia Rio', service: 'Мойка' },
      { id: 'b', timeFrom: '14:00', timeTo: null, car: 'BMW X5', service: 'Полировка' },
    ]
    expect(describeDayBookings(list)).toEqual({
      title: '2 записи\n\n10:00–12:00 Kia Rio — Мойка\n\n14:00 BMW X5 — Полировка',
      label: '2 записи: 10:00–12:00 Kia Rio — Мойка; 14:00 BMW X5 — Полировка',
    })
    expect(describeDayBookings(list.slice(0, 1)).label).toMatch(/^1 запись:/)
  })
})

describe('weekdayName', () => {
  it('называет день недели полностью', () => {
    expect(weekdayName('2026-11-07')).toBe('суббота')
  })
})
