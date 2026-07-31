import { describe, it, expect } from 'vitest'
import {
  computeSalary,
  hoursToMinutes,
  minutesToHours,
  monthRange,
  monthSchema,
  rateInputSchema,
  salaryFromMinutesRateSum,
  workHoursInputSchema,
  workHoursUpdateSchema,
} from '../src/salaries.js'

describe('hoursToMinutes', () => {
  it('rounds float dust away (7.51 → 451, not 450)', () => {
    expect(hoursToMinutes(7.51)).toBe(451)
  })

  it('maps exact quarter-hours cleanly', () => {
    expect(hoursToMinutes(7.5)).toBe(450)
    expect(hoursToMinutes(0.25)).toBe(15)
    expect(hoursToMinutes(8)).toBe(480)
  })
})

describe('minutesToHours', () => {
  it('inverts hoursToMinutes for quarter-hour values', () => {
    expect(minutesToHours(450)).toBe(7.5)
    expect(minutesToHours(15)).toBe(0.25)
  })
})

describe('computeSalary — single rounding per month', () => {
  it('rounds the month total once: 2×25min × 100₽/ч → 83, not 84', () => {
    // Per-row rounding would give round(2500/60)=42 twice = 84; the correct
    // answer rounds round(5000/60) once = 83.
    const entries = [
      { minutes: 25, rate: 100 },
      { minutes: 25, rate: 100 },
    ]
    expect(computeSalary(entries)).toBe(83)
  })

  it('sums across differing rate snapshots (rate change mid-month)', () => {
    // 60min@100 + 60min@200 = 6000+12000 = 18000 ₽·min / 60 = 300 ₽
    const entries = [
      { minutes: 60, rate: 100 },
      { minutes: 60, rate: 200 },
    ]
    expect(computeSalary(entries)).toBe(300)
  })

  it('is zero for no entries', () => {
    expect(computeSalary([])).toBe(0)
  })

  it('agrees with salaryFromMinutesRateSum on the aggregate', () => {
    const entries = [
      { minutes: 25, rate: 100 },
      { minutes: 25, rate: 100 },
    ]
    const sum = entries.reduce((a, e) => a + e.minutes * e.rate, 0)
    expect(salaryFromMinutesRateSum(sum)).toBe(computeSalary(entries))
  })
})

describe('rateInputSchema', () => {
  it('accepts a positive integer rate', () => {
    expect(rateInputSchema.safeParse({ masterId: 1, hourlyRate: 500 }).success).toBe(true)
  })

  it('rejects a 0 rate (min(1) — 0 would silently zero salary)', () => {
    expect(rateInputSchema.safeParse({ masterId: 1, hourlyRate: 0 }).success).toBe(false)
  })

  it('rejects a non-integer or non-positive masterId', () => {
    expect(rateInputSchema.safeParse({ masterId: 0, hourlyRate: 500 }).success).toBe(false)
    expect(rateInputSchema.safeParse({ masterId: 1.5, hourlyRate: 500 }).success).toBe(false)
  })

  it('rejects a fractional rate', () => {
    expect(rateInputSchema.safeParse({ masterId: 1, hourlyRate: 500.5 }).success).toBe(false)
  })
})

describe('workHoursInputSchema', () => {
  const base = { masterId: 1, workDate: '2026-07-15' }

  it('accepts a quarter-hour value with an optional note', () => {
    expect(workHoursInputSchema.safeParse({ ...base, hours: 7.5, note: 'смена' }).success).toBe(true)
    expect(workHoursInputSchema.safeParse({ ...base, hours: 0.25 }).success).toBe(true)
  })

  it('rejects hours not on the 0.25 grid', () => {
    expect(workHoursInputSchema.safeParse({ ...base, hours: 7.1 }).success).toBe(false)
  })

  it('rejects non-positive or >24 hours', () => {
    expect(workHoursInputSchema.safeParse({ ...base, hours: 0 }).success).toBe(false)
    expect(workHoursInputSchema.safeParse({ ...base, hours: 24.25 }).success).toBe(false)
  })

  it('rejects a malformed or impossible ISO date', () => {
    expect(workHoursInputSchema.safeParse({ masterId: 1, workDate: '15.07.2026', hours: 8 }).success).toBe(false)
    expect(workHoursInputSchema.safeParse({ masterId: 1, workDate: '2026-02-31', hours: 8 }).success).toBe(false)
    expect(workHoursInputSchema.safeParse({ masterId: 1, workDate: '2026-13-01', hours: 8 }).success).toBe(false)
  })
})

describe('workHoursUpdateSchema', () => {
  it('accepts a partial patch (all fields optional)', () => {
    expect(workHoursUpdateSchema.safeParse({}).success).toBe(true)
    expect(workHoursUpdateSchema.safeParse({ hours: 6 }).success).toBe(true)
    expect(workHoursUpdateSchema.safeParse({ note: 'fix' }).success).toBe(true)
  })

  it('has no masterId — a stray masterId is ignored, not accepted as a field', () => {
    const r = workHoursUpdateSchema.safeParse({ masterId: 9, hours: 6 })
    expect(r.success).toBe(true)
    if (r.success) expect('masterId' in r.data).toBe(false)
  })
})

describe('monthSchema', () => {
  it('accepts a valid YYYY-MM', () => {
    expect(monthSchema.safeParse('2026-07').success).toBe(true)
    expect(monthSchema.safeParse('2026-12').success).toBe(true)
    expect(monthSchema.safeParse('2026-01').success).toBe(true)
  })

  it('rejects month 00, 13, or a malformed shape', () => {
    expect(monthSchema.safeParse('2026-00').success).toBe(false)
    expect(monthSchema.safeParse('2026-13').success).toBe(false)
    expect(monthSchema.safeParse('2026-7').success).toBe(false)
    expect(monthSchema.safeParse('26-07').success).toBe(false)
  })
})

describe('monthRange', () => {
  it('returns a half-open range within the same year', () => {
    expect(monthRange('2026-07')).toEqual({ start: '2026-07-01', end: '2026-08-01' })
  })

  it('rolls December over to next January', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })
})
