import { describe, expect, it } from 'vitest'
import { buildMonthOptions, currentMonthKey, MONTH_NAMES } from '@/lib/month-options'

describe('buildMonthOptions', () => {
  it('spans the rolling window newest-first (1 ahead … 12 back = 14 months)', () => {
    const opts = buildMonthOptions()
    expect(opts).toHaveLength(14)
    // Newest first: each value strictly greater than the next.
    for (let i = 0; i < opts.length - 1; i++) {
      expect(opts[i]!.value > opts[i + 1]!.value).toBe(true)
    }
  })

  it('emits YYYY-MM values with ru-RU month labels', () => {
    const opts = buildMonthOptions()
    for (const o of opts) {
      expect(o.value).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
      const monthIdx = Number(o.value.slice(5, 7)) - 1
      expect(o.label.startsWith(MONTH_NAMES[monthIdx]!)).toBe(true)
    }
  })

  it('honours a custom window size', () => {
    expect(buildMonthOptions(0, 2)).toHaveLength(3)
  })

  it('includes the current month', () => {
    const opts = buildMonthOptions()
    expect(opts.some((o) => o.value === currentMonthKey())).toBe(true)
  })
})

describe('currentMonthKey', () => {
  it('is a valid YYYY-MM string', () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })
})
