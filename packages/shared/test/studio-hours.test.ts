import { describe, expect, it } from 'vitest'
import {
  datesOnClosedDays,
  formatStudioHours,
  isoWeekday,
  minutesToTime,
  studioDaySchema,
  timeToMinutes,
} from '../src/studio-hours.js'

describe('formatStudioHours', () => {
  it('сливает соседние дни с одинаковыми часами и называет выходные', () => {
    const days = [0, 1, 2, 3, 4].map((weekday) => ({
      weekday,
      opensAt: '09:00',
      closesAt: '21:00',
    }))
    days.push({ weekday: 5, opensAt: '10:00', closesAt: '18:00' })
    expect(formatStudioHours(days)).toEqual(['Пн–Пт 09:00–21:00', 'Сб 10:00–18:00', 'Вс выходной'])
  })

  it('два соседних дня пишет через запятую, а не диапазоном', () => {
    expect(
      formatStudioHours([
        { weekday: 5, opensAt: '10:00', closesAt: '18:00' },
        { weekday: 6, opensAt: '10:00', closesAt: '18:00' },
      ]),
    ).toEqual(['Пн–Пт выходной', 'Сб, Вс 10:00–18:00'])
  })
})

describe('время дня', () => {
  it('переводит туда и обратно, включая полночь в конце дня', () => {
    expect(timeToMinutes('09:30')).toBe(570)
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(timeToMinutes('24:00'))).toBe('24:00')
  })

  it('не принимает закрытие в момент открытия', () => {
    expect(
      studioDaySchema.safeParse({ weekday: 0, opensAt: '10:00', closesAt: '10:00' }).success,
    ).toBe(false)
  })
})

describe('datesOnClosedDays', () => {
  // 2026-11-23 — понедельник, 2026-11-29 — воскресенье.
  const weekdaysOnly = [0, 1, 2, 3, 4].map((weekday) => ({
    weekday,
    opensAt: '10:00',
    closesAt: '20:00',
  }))

  it('считает понедельник нулем', () => {
    expect(isoWeekday('2026-11-23')).toBe(0)
    expect(isoWeekday('2026-11-29')).toBe(6)
  })

  it('находит только рабочие дни, выпавшие на выходные студии', () => {
    expect(
      datesOnClosedDays(weekdaysOnly, [
        { date: '2026-11-29', working: true },
        { date: '2026-11-28', working: false },
        { date: '2026-11-23', working: true },
      ]),
    ).toEqual(['2026-11-29'])
  })

  it('без заданного режима ничего не запрещает', () => {
    expect(datesOnClosedDays([], [{ date: '2026-11-29', working: true }])).toEqual([])
  })
})
