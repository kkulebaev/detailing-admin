import { describe, expect, it } from 'vitest'
import {
  formatStudioHours,
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
