import { assert, describe, expect, it } from 'vitest'
import {
  ROLES,
  canCreateBookings,
  canEditBookings,
  canSeeAmounts,
  changePasswordRequestSchema,
  loginRequestSchema,
  roleSchema,
  toRole,
} from '../src/auth.js'

describe('roleSchema', () => {
  it('принимает известные роли', () => {
    expect(roleSchema.parse('admin')).toBe('admin')
    expect(roleSchema.parse('booker')).toBe('booker')
    expect(roleSchema.parse('employee')).toBe('employee')
  })

  it('отклоняет неизвестные роли', () => {
    expect(roleSchema.safeParse('superuser').success).toBe(false)
  })

  it('ROLES — единственный источник enum', () => {
    expect([...ROLES]).toEqual(['admin', 'booker', 'employee'])
  })
})

describe('toRole', () => {
  it('сохраняет известные роли', () => {
    expect(toRole('admin')).toBe('admin')
    expect(toRole('booker')).toBe('booker')
    expect(toRole('employee')).toBe('employee')
  })

  it('сводит всё остальное к наименее привилегированной роли', () => {
    expect(toRole('superuser')).toBe('employee')
    expect(toRole('')).toBe('employee')
  })
})

describe('права ролей', () => {
  it('разрешает admin и booker создавать и править записи и видеть суммы, а employee — нет', () => {
    for (const can of [canCreateBookings, canEditBookings, canSeeAmounts]) {
      expect(can('admin')).toBe(true)
      expect(can('booker')).toBe(true)
      expect(can('employee')).toBe(false)
    }
  })
})

describe('loginRequestSchema', () => {
  it('принимает валидную пару логин/пароль', () => {
    expect(loginRequestSchema.safeParse({ login: 'ivan', password: 'secret' }).success).toBe(true)
  })

  it('отклоняет пустой логин', () => {
    expect(loginRequestSchema.safeParse({ login: '', password: 'secret' }).success).toBe(false)
  })

  it('отклоняет пустой пароль', () => {
    expect(loginRequestSchema.safeParse({ login: 'ivan', password: '' }).success).toBe(false)
  })

  it('разрешает не передавать remember (на сервере по умолчанию false)', () => {
    const r = loginRequestSchema.safeParse({ login: 'ivan', password: 'secret' })
    expect(r.success).toBe(true)
    expect(r.success && r.data.remember).toBeUndefined()
  })

  it('сохраняет явно переданный флаг remember', () => {
    const r = loginRequestSchema.safeParse({ login: 'ivan', password: 'secret', remember: true })
    expect(r.success && r.data.remember).toBe(true)
  })
})

describe('changePasswordRequestSchema', () => {
  it('принимает смену на другой пароль от 8 символов', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'old-secret',
      newPassword: 'brand-new-secret',
    })
    expect(r.success).toBe(true)
  })

  it('отклоняет новый пароль короче 8 символов', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'old-secret',
      newPassword: 'short',
    })
    expect(r.success).toBe(false)
  })

  it('отклоняет новый пароль, совпадающий с текущим', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'same-secret',
      newPassword: 'same-secret',
    })
    assert(!r.success)
    expect(r.error.issues.some((i) => i.path[0] === 'newPassword')).toBe(true)
  })
})
