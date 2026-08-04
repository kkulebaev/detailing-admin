import { describe, it, expect } from 'vitest'
import { carInputSchema, clientInputSchema } from '../src/client.js'

describe('carInputSchema', () => {
  it('requires a non-empty make/model', () => {
    const r = carInputSchema.safeParse({ makeModel: '   ', plate: 'А123АА77' })
    expect(r.success).toBe(false)
  })

  it('trims make/model and plate', () => {
    const r = carInputSchema.parse({ makeModel: '  Toyota Camry  ', plate: '  А123АА77  ' })
    expect(r).toEqual({ makeModel: 'Toyota Camry', plate: 'А123АА77' })
  })

  it('defaults plate to an empty string when omitted', () => {
    const r = carInputSchema.parse({ makeModel: 'BMW X5' })
    expect(r).toEqual({ makeModel: 'BMW X5', plate: '' })
  })
})

describe('clientInputSchema', () => {
  it('passes cars through the transform', () => {
    const r = clientInputSchema.parse({
      name: '  Иван  ',
      phone: '+79001234567',
      cars: [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }],
    })
    expect(r).toEqual({
      name: 'Иван',
      phone: '+79001234567',
      cars: [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }],
    })
  })

  it('defaults cars to [] when the field is absent', () => {
    const r = clientInputSchema.parse({ name: 'Иван', phone: '+79001234567' })
    expect(r.cars).toEqual([])
  })

  it('still rejects an empty phone', () => {
    const r = clientInputSchema.safeParse({ name: 'Иван', phone: '', cars: [] })
    expect(r.success).toBe(false)
  })
})
