import { describe, it, expect } from 'vitest'
import { masterInputSchema, reorderInputSchema } from '../src/masters.js'

describe('masterInputSchema', () => {
  const base = { canBeResponsible: true, paidSalary: true, telegramId: null }

  it('accepts a known name with the flag and null telegramId', () => {
    const r = masterInputSchema.safeParse({ name: 'Иван Содель', ...base })
    expect(r.success).toBe(true)
  })

  it('accepts an arbitrary new name outside the old enum', () => {
    const r = masterInputSchema.safeParse({ name: 'Новый Мастер', ...base })
    expect(r.success).toBe(true)
  })

  it('rejects a payload missing canBeResponsible — no default, so PATCH omission cannot resurrect it', () => {
    const r = masterInputSchema.safeParse({ name: 'Пётр Новый', paidSalary: true, telegramId: null })
    expect(r.success).toBe(false)
  })

  it('rejects a payload missing paidSalary — no default', () => {
    const r = masterInputSchema.safeParse({ name: 'Пётр Новый', canBeResponsible: true, telegramId: null })
    expect(r.success).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    const r = masterInputSchema.safeParse({ name: '  Иван Содель  ', ...base })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.name).toBe('Иван Содель')
  })

  it('rejects an empty name', () => {
    expect(masterInputSchema.safeParse({ name: '', ...base }).success).toBe(false)
    expect(masterInputSchema.safeParse({ name: '   ', ...base }).success).toBe(false)
  })

  it.each(['=SUM(A1)', '+x', '-x', '@x'])('rejects injection-prefixed name %s', (name) => {
    expect(masterInputSchema.safeParse({ name, ...base }).success).toBe(false)
  })

  it('respects the supplied canBeResponsible value', () => {
    const r = masterInputSchema.safeParse({
      name: 'Андрей и ко.',
      canBeResponsible: false,
      paidSalary: true,
      telegramId: null,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.canBeResponsible).toBe(false)
  })

  it('accepts a string telegramId', () => {
    const r = masterInputSchema.safeParse({
      name: 'Иван Содель',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: '123456789',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.telegramId).toBe('123456789')
  })

  it('accepts a null telegramId', () => {
    const r = masterInputSchema.safeParse({ name: 'Иван Содель', canBeResponsible: true, paidSalary: true, telegramId: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.telegramId).toBeNull()
  })
})

describe('reorderInputSchema', () => {
  it('accepts an array of positive ids', () => {
    const r = reorderInputSchema.safeParse({ ids: [3, 1, 2] })
    expect(r.success).toBe(true)
  })

  it('rejects non-positive ids', () => {
    expect(reorderInputSchema.safeParse({ ids: [0, 1] }).success).toBe(false)
    expect(reorderInputSchema.safeParse({ ids: [-1] }).success).toBe(false)
  })

  it('rejects non-integer ids', () => {
    expect(reorderInputSchema.safeParse({ ids: [1.5] }).success).toBe(false)
  })
})
