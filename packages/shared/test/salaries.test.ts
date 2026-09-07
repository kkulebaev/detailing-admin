import { describe, it, expect } from 'vitest'
import {
  computeSalary,
  hoursToMinutes,
  mergeSalaryEntries,
  minutesToHours,
  monthRange,
  monthSchema,
  payoutInputSchema,
  payoutUpdateSchema,
  rateInputSchema,
  salaryEntryDate,
  salaryFromMinutesRateSum,
  workHoursInputSchema,
  workHoursUpdateSchema,
  type Payout,
  type WorkHours,
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

describe('payoutInputSchema', () => {
  const base = { masterId: 1, payoutDate: '2026-07-15' }

  it('accepts a positive and a negative whole amount', () => {
    expect(payoutInputSchema.safeParse({ ...base, amount: 5000 }).success).toBe(true)
    expect(payoutInputSchema.safeParse({ ...base, amount: -2000, note: 'штраф' }).success).toBe(true)
  })

  it('rejects a zero amount with the domain message', () => {
    const r = payoutInputSchema.safeParse({ ...base, amount: 0 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]!.message).toBe('Сумма не может быть нулевой')
  })

  it('rejects a fractional amount (money is whole rubles)', () => {
    expect(payoutInputSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false)
  })

  it('rejects an amount past the ±10 000 000 guard', () => {
    expect(payoutInputSchema.safeParse({ ...base, amount: 10_000_001 }).success).toBe(false)
    expect(payoutInputSchema.safeParse({ ...base, amount: -10_000_001 }).success).toBe(false)
  })

  it('rejects a malformed or impossible ISO date', () => {
    expect(payoutInputSchema.safeParse({ masterId: 1, payoutDate: '2026-02-31', amount: 100 }).success).toBe(false)
    expect(payoutInputSchema.safeParse({ masterId: 1, payoutDate: '15.07.2026', amount: 100 }).success).toBe(false)
  })
})

describe('payoutUpdateSchema', () => {
  it('accepts a partial patch (all fields optional)', () => {
    expect(payoutUpdateSchema.safeParse({}).success).toBe(true)
    expect(payoutUpdateSchema.safeParse({ amount: -500 }).success).toBe(true)
    expect(payoutUpdateSchema.safeParse({ note: 'fix' }).success).toBe(true)
  })

  it('still refuses a zero amount when the field is present', () => {
    expect(payoutUpdateSchema.safeParse({ amount: 0 }).success).toBe(false)
  })

  it('has no masterId — the master never changes on edit', () => {
    const r = payoutUpdateSchema.safeParse({ masterId: 9, amount: 100 })
    expect(r.success).toBe(true)
    if (r.success) expect('masterId' in r.data).toBe(false)
  })
})

describe('mergeSalaryEntries', () => {
  const hours = (id: number, workDate: string): WorkHours => ({
    id,
    masterId: 1,
    workDate,
    minutes: 480,
    rateSnapshot: 100,
    note: '',
    createdAt: '2026-07-01T00:00:00.000Z',
  })
  const payout = (id: number, payoutDate: string): Payout => ({
    id,
    masterId: 1,
    payoutDate,
    amount: 1000,
    note: '',
    createdAt: '2026-07-01T00:00:00.000Z',
  })

  it('returns an empty feed for empty inputs', () => {
    expect(mergeSalaryEntries([], [])).toEqual([])
  })

  it('orders by date ascending across both kinds', () => {
    const feed = mergeSalaryEntries([hours(1, '2026-07-20')], [payout(2, '2026-07-05')])
    expect(feed.map(salaryEntryDate)).toEqual(['2026-07-05', '2026-07-20'])
    expect(feed.map((e) => e.kind)).toEqual(['payout', 'hours'])
  })

  it('puts hours before payouts on the same day', () => {
    const feed = mergeSalaryEntries([hours(7, '2026-07-10')], [payout(3, '2026-07-10')])
    expect(feed.map((e) => e.kind)).toEqual(['hours', 'payout'])
  })

  it('breaks a same-day, same-kind tie by id', () => {
    const feed = mergeSalaryEntries([hours(9, '2026-07-10'), hours(2, '2026-07-10')], [])
    expect(feed.map((e) => e.id)).toEqual([2, 9])
  })

  it('tags every entry with its kind and keeps the source field names', () => {
    const feed = mergeSalaryEntries([hours(1, '2026-07-01')], [payout(1, '2026-07-02')])
    const [first, second] = feed
    expect(first!.kind === 'hours' && first.workDate).toBe('2026-07-01')
    expect(second!.kind === 'payout' && second.payoutDate).toBe('2026-07-02')
  })
})
