import { describe, expect, it } from 'vitest'
import { formatServiceDuration, serviceInputSchema } from '../src/pricelist.js'

const base = {
  sectionId: 1,
  name: 'Полировка',
  priceClass1Min: 1000,
  priceClass2Min: 1000,
  priceClass3Min: 1000,
  priceClass4Min: 1000,
}

describe('serviceInputSchema.durationMinutes', () => {
  it('без поля время не задано', () => {
    expect(serviceInputSchema.parse(base).durationMinutes).toBeNull()
  })

  it('принимает целые минуты до 200 часов', () => {
    expect(serviceInputSchema.parse({ ...base, durationMinutes: 90 }).durationMinutes).toBe(90)
    expect(serviceInputSchema.safeParse({ ...base, durationMinutes: 200 * 60 }).success).toBe(true)
  })

  it.each([0, -30, 1.5, 200 * 60 + 1])('отклоняет %s', (durationMinutes) => {
    expect(serviceInputSchema.safeParse({ ...base, durationMinutes }).success).toBe(false)
  })
})

describe('formatServiceDuration', () => {
  it.each([
    [45, '45 мин'],
    [120, '2 ч'],
    [150, '2 ч 30 мин'],
    [48 * 60, '48 ч'],
  ])('%i → %s', (minutes, text) => {
    expect(formatServiceDuration(minutes)).toBe(text)
  })
})
