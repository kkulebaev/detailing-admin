import { assert, describe, it, expect } from 'vitest'
import { masterInputSchema, reorderInputSchema } from '../src/masters.js'

describe('masterInputSchema', () => {
  const base = { canBeResponsible: true, paidSalary: true, telegramId: null, userId: null }

  it('принимает известное имя с флагом и telegramId = null', () => {
    const r = masterInputSchema.safeParse({ name: 'Иван Содель', ...base })
    expect(r.success).toBe(true)
  })

  it('принимает произвольное новое имя вне старого enum', () => {
    const r = masterInputSchema.safeParse({ name: 'Новый Мастер', ...base })
    expect(r.success).toBe(true)
  })

  it('отклоняет payload без canBeResponsible — дефолта нет, поэтому пропуск в PATCH не воскресит его', () => {
    const r = masterInputSchema.safeParse({
      name: 'Пётр Новый',
      paidSalary: true,
      telegramId: null,
    })
    expect(r.success).toBe(false)
  })

  it('отклоняет payload без paidSalary — дефолта нет', () => {
    const r = masterInputSchema.safeParse({
      name: 'Пётр Новый',
      canBeResponsible: true,
      telegramId: null,
    })
    expect(r.success).toBe(false)
  })

  it('обрезает пробелы по краям', () => {
    const r = masterInputSchema.safeParse({ name: '  Иван Содель  ', ...base })
    assert(r.success)
    expect(r.data.name).toBe('Иван Содель')
  })

  it('отклоняет пустое имя', () => {
    expect(masterInputSchema.safeParse({ name: '', ...base }).success).toBe(false)
    expect(masterInputSchema.safeParse({ name: '   ', ...base }).success).toBe(false)
  })

  it.each(['=SUM(A1)', '+x', '-x', '@x'])('отклоняет имя с префиксом инъекции %s', (name) => {
    expect(masterInputSchema.safeParse({ name, ...base }).success).toBe(false)
  })

  it('учитывает переданное значение canBeResponsible', () => {
    const r = masterInputSchema.safeParse({
      name: 'Андрей и ко.',
      canBeResponsible: false,
      paidSalary: true,
      telegramId: null,
      userId: null,
    })
    assert(r.success)
    expect(r.data.canBeResponsible).toBe(false)
  })

  it('принимает строковый telegramId', () => {
    const r = masterInputSchema.safeParse({
      name: 'Иван Содель',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: '123456789',
      userId: null,
    })
    assert(r.success)
    expect(r.data.telegramId).toBe('123456789')
  })

  it('принимает telegramId = null', () => {
    const r = masterInputSchema.safeParse({
      name: 'Иван Содель',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: null,
      userId: null,
    })
    assert(r.success)
    expect(r.data.telegramId).toBeNull()
  })

  it('принимает id привязанного аккаунта и отклоняет не-uuid', () => {
    const userId = '0b3c6f0e-6f8b-4a8e-9d2f-1c2b3a4d5e6f'
    expect(masterInputSchema.safeParse({ name: 'Иван', ...base, userId }).success).toBe(true)
    expect(masterInputSchema.safeParse({ name: 'Иван', ...base, userId: 'emp' }).success).toBe(
      false,
    )
  })

  it('требует userId при полной замене, чтобы PATCH не мог молча отвязать аккаунт', () => {
    const { userId: _omit, ...withoutUser } = base
    expect(masterInputSchema.safeParse({ name: 'Иван', ...withoutUser }).success).toBe(false)
  })
})

describe('reorderInputSchema', () => {
  it('принимает массив положительных id', () => {
    const r = reorderInputSchema.safeParse({ ids: [3, 1, 2] })
    expect(r.success).toBe(true)
  })

  it('отклоняет неположительные id', () => {
    expect(reorderInputSchema.safeParse({ ids: [0, 1] }).success).toBe(false)
    expect(reorderInputSchema.safeParse({ ids: [-1] }).success).toBe(false)
  })

  it('отклоняет нецелые id', () => {
    expect(reorderInputSchema.safeParse({ ids: [1.5] }).success).toBe(false)
  })
})
