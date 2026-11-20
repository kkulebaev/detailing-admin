import { describe, expect, it } from 'vitest'
import { formatDayList } from '@/lib/schedule-format'

describe('formatDayList', () => {
  it('сортирует дни и пишет месяц один раз после его чисел', () => {
    expect(formatDayList(['2026-12-05', '2027-01-02', '2026-12-03'])).toBe('3, 5 декабря, 2 января')
  })
})
