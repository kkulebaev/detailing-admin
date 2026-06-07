import { describe, it, expect } from 'vitest'
import { bookingSchema } from '../src/booking.js'

const validBase = {
  dateFrom: '04.06.2026',
  time: '10:00',
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  amount: 5000,
  master: 'Иван Содель',
  responsible: 'Иван Содель',
  carClass: 3,
}

describe('bookingSchema', () => {
  it('parses a valid minimal payload', () => {
    const result = bookingSchema.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  it('rejects bad time 25:99', () => {
    const result = bookingSchema.safeParse({ ...validBase, time: '25:99' })
    expect(result.success).toBe(false)
  })

  it('rejects bad time 24:00', () => {
    const result = bookingSchema.safeParse({ ...validBase, time: '24:00' })
    expect(result.success).toBe(false)
  })

  it('rejects bad date format', () => {
    const result = bookingSchema.safeParse({ ...validBase, dateFrom: '2026-06-04' })
    expect(result.success).toBe(false)
  })

  it('phone transform produces canonical E.164 form', () => {
    const result = bookingSchema.safeParse({ ...validBase, phone: '8 999 123 45 67' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.phone).toBe('+79991234567')
  })

  it('phone garbage produces a ZodIssue at path ["phone"]', () => {
    const result = bookingSchema.safeParse({ ...validBase, phone: '123' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const phoneIssue = result.error.issues.find(
        (i) => JSON.stringify(i.path) === JSON.stringify(['phone'])
      )
      expect(phoneIssue).toBeDefined()
      expect(result.error.issues).toHaveLength(1)
    }
  })

  it('rejects dateTo < dateFrom across year boundary', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      dateFrom: '02.01.2026',
      dateTo: '30.12.2025',
    })
    expect(result.success).toBe(false)
  })

  it('accepts dateTo > dateFrom across year boundary', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      dateFrom: '30.12.2025',
      dateTo: '02.01.2026',
    })
    expect(result.success).toBe(true)
  })

  it('collapses dateFrom === dateTo to dateTo: undefined', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      dateFrom: '04.06.2026',
      dateTo: '04.06.2026',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.dateTo).toBeUndefined()
  })

  it('rejects amount as empty string', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: '' })
    expect(result.success).toBe(false)
  })

  it('accepts amount 200000', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: 200000 })
    expect(result.success).toBe(true)
  })

  it('rejects negative amount', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: -1 })
    expect(result.success).toBe(false)
  })

  it('accepts amount above the previous 10M cap (no silent upper bound)', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: 25_000_000 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.amount).toBe(25_000_000)
  })

  it('readiness: accepts explicit empty string', () => {
    const result = bookingSchema.safeParse({ ...validBase, readiness: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.readiness).toBe('')
  })

  it('readiness: accepts a valid enum value', () => {
    const result = bookingSchema.safeParse({ ...validBase, readiness: 'Выдана' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.readiness).toBe('Выдана')
  })

  it('readiness: defaults to empty string when omitted', () => {
    const result = bookingSchema.safeParse(validBase)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.readiness).toBe('')
  })

  it('responsible: rejects explicit empty string', () => {
    const result = bookingSchema.safeParse({ ...validBase, responsible: '' })
    expect(result.success).toBe(false)
  })

  it('responsible: rejects when omitted', () => {
    const { responsible: _omit, ...withoutResponsible } = validBase
    const result = bookingSchema.safeParse(withoutResponsible)
    expect(result.success).toBe(false)
  })

  it('rejects time field longer than 5 chars even when regex would otherwise match', () => {
    const result = bookingSchema.safeParse({ ...validBase, time: '010:00' })
    expect(result.success).toBe(false)
  })

  it('rejects dateFrom longer than 10 chars even when regex would otherwise match', () => {
    const result = bookingSchema.safeParse({ ...validBase, dateFrom: '004.06.2026' })
    expect(result.success).toBe(false)
  })
})
