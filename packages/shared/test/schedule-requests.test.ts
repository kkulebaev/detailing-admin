import { describe, expect, it } from 'vitest'
import {
  SCHEDULE_REQUEST_HORIZON_DAYS,
  scheduleRequestDatesProblem,
  scheduleRequestInputSchema,
} from '../src/schedule-requests.js'

describe('scheduleRequestDatesProblem', () => {
  it('прошлые, сегодняшний и будущие дни можно подать', () => {
    expect(
      scheduleRequestDatesProblem(['2026-10-01', '2026-11-20', '2026-12-01'], '2026-11-20'),
    ).toBeNull()
  })

  it('граница горизонта включительно, день за ней — too_far', () => {
    const last = new Date(Date.UTC(2026, 10, 20 + SCHEDULE_REQUEST_HORIZON_DAYS))
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    expect(scheduleRequestDatesProblem([iso(last)], '2026-11-20')).toBeNull()
    last.setUTCDate(last.getUTCDate() + 1)
    expect(scheduleRequestDatesProblem([iso(last)], '2026-11-20')).toBe('too_far')
  })
})

describe('scheduleRequestInputSchema', () => {
  it('отклоняет пустую заявку и повтор одного дня', () => {
    expect(scheduleRequestInputSchema.safeParse({ days: [] }).success).toBe(false)
    const twice = [
      { date: '2026-11-25', working: true },
      { date: '2026-11-25', working: false },
    ]
    expect(scheduleRequestInputSchema.safeParse({ days: twice }).success).toBe(false)
  })
})
