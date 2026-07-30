import { describe, it, expect } from 'vitest'
import { parseDdmmyyyy, ddmmyyyyToIso } from '../src/date.js'

describe('parseDdmmyyyy', () => {
  it('parses 30.12.2025 to correct UTC date', () => {
    const d = parseDdmmyyyy('30.12.2025')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(11) // 0-indexed: 11 = December
    expect(d.getUTCDate()).toBe(30)
  })

  it('correctly orders dates across year boundary', () => {
    const jan = parseDdmmyyyy('02.01.2026')
    const dec = parseDdmmyyyy('30.12.2025')
    expect(jan > dec).toBe(true)
  })

  it('throws on day 32', () => {
    expect(() => parseDdmmyyyy('32.01.2026')).toThrow()
  })

  it('throws on month 13', () => {
    expect(() => parseDdmmyyyy('01.13.2026')).toThrow()
  })

  it('throws on non-numeric input', () => {
    expect(() => parseDdmmyyyy('aa.bb.cccc')).toThrow()
  })
})

describe('ddmmyyyyToIso', () => {
  it('rearranges DD.MM.YYYY to YYYY-MM-DD without timezone drift', () => {
    expect(ddmmyyyyToIso('04.06.2026')).toBe('2026-06-04')
    expect(ddmmyyyyToIso('31.12.2025')).toBe('2025-12-31')
  })

  it('throws on an invalid date rather than emitting a bad ISO string', () => {
    expect(() => ddmmyyyyToIso('32.01.2026')).toThrow()
    expect(() => ddmmyyyyToIso('01.13.2026')).toThrow()
  })
})
