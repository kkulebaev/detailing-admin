import { describe, it, expect } from 'vitest'
import {
  SCHEDULE_MAX_RANGE_DAYS,
  findDaysOff,
  isoDaysBetween,
  monthScheduleRange,
  scheduleDayInputSchema,
  scheduleMonthsRange,
  scheduleRangeDays,
} from '../src/schedule.js'

describe('isoDaysBetween', () => {
  it('включает обе границы и переходит через конец месяца', () => {
    expect(isoDaysBetween('2026-11-29', '2026-12-02')).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ])
  })

  it('пусто, если конец раньше начала', () => {
    expect(isoDaysBetween('2026-11-02', '2026-11-01')).toEqual([])
  })

  it('не разворачивает больше SCHEDULE_MAX_RANGE_DAYS дней', () => {
    expect(isoDaysBetween('2026-01-01', '2036-01-01')).toHaveLength(SCHEDULE_MAX_RANGE_DAYS)
  })
})

describe('диапазоны', () => {
  it('scheduleRangeDays считает дни включительно', () => {
    expect(scheduleRangeDays('2026-11-01', '2026-11-01')).toBe(1)
    expect(scheduleRangeDays('2026-02-01', '2026-03-01')).toBe(29)
  })

  it('scheduleMonthsRange расширяет до целых месяцев', () => {
    expect(scheduleMonthsRange('2026-11-15', '2026-12-03')).toEqual({
      from: '2026-11-01',
      to: '2026-12-31',
    })
  })

  it('monthScheduleRange учитывает длину месяца', () => {
    expect(monthScheduleRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('findDaysOff', () => {
  const schedule = [{ masterId: 1, dates: ['2026-11-16', '2026-11-17'] }]

  it('рабочий день не выходной', () => {
    expect(findDaysOff(schedule, [1], '2026-11-16', '2026-11-16')).toEqual([])
  })

  it('день без отметки — выходной', () => {
    expect(findDaysOff(schedule, [1], '2026-11-17', '2026-11-19')).toEqual([
      { masterId: 1, dates: ['2026-11-18', '2026-11-19'] },
    ])
  })

  it('незаполненный месяц и мастер без графика — тоже выходные', () => {
    expect(findDaysOff(schedule, [1], '2026-12-01', '2026-12-01')).toEqual([
      { masterId: 1, dates: ['2026-12-01'] },
    ])
    expect(findDaysOff(schedule, [2], '2026-11-18', '2026-11-18')).toEqual([
      { masterId: 2, dates: ['2026-11-18'] },
    ])
  })
})

describe('scheduleDayInputSchema', () => {
  it('отклоняет несуществующую дату', () => {
    expect(
      scheduleDayInputSchema.safeParse({ masterId: 1, date: '2026-02-30', working: true }).success,
    ).toBe(false)
  })
})
