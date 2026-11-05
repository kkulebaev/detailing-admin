import { describe, expect, it } from 'vitest'
import {
  ROLES,
  canCreateBookings,
  canSeeAmounts,
  changePasswordRequestSchema,
  loginRequestSchema,
  roleSchema,
  toRole,
} from '../src/auth.js'

describe('roleSchema', () => {
  it('accepts the known roles', () => {
    expect(roleSchema.parse('admin')).toBe('admin')
    expect(roleSchema.parse('booker')).toBe('booker')
    expect(roleSchema.parse('employee')).toBe('employee')
  })

  it('rejects unknown roles', () => {
    expect(roleSchema.safeParse('superuser').success).toBe(false)
  })

  it('ROLES is the single source of the enum', () => {
    expect([...ROLES]).toEqual(['admin', 'booker', 'employee'])
  })
})

describe('toRole', () => {
  it('keeps known roles', () => {
    expect(toRole('admin')).toBe('admin')
    expect(toRole('booker')).toBe('booker')
    expect(toRole('employee')).toBe('employee')
  })

  it('collapses anything else to the least privileged role', () => {
    expect(toRole('superuser')).toBe('employee')
    expect(toRole('')).toBe('employee')
  })
})

describe('role permissions', () => {
  it('lets admin and booker create bookings and see amounts, not employee', () => {
    for (const can of [canCreateBookings, canSeeAmounts]) {
      expect(can('admin')).toBe(true)
      expect(can('booker')).toBe(true)
      expect(can('employee')).toBe(false)
    }
  })
})

describe('loginRequestSchema', () => {
  it('accepts a valid credential pair', () => {
    expect(loginRequestSchema.safeParse({ login: 'ivan', password: 'secret' }).success).toBe(true)
  })

  it('rejects an empty login', () => {
    expect(loginRequestSchema.safeParse({ login: '', password: 'secret' }).success).toBe(false)
  })

  it('rejects an empty password', () => {
    expect(loginRequestSchema.safeParse({ login: 'ivan', password: '' }).success).toBe(false)
  })

  it('allows omitting remember (defaulted to false server-side)', () => {
    const r = loginRequestSchema.safeParse({ login: 'ivan', password: 'secret' })
    expect(r.success).toBe(true)
    expect(r.success && r.data.remember).toBeUndefined()
  })

  it('keeps an explicit remember flag', () => {
    const r = loginRequestSchema.safeParse({ login: 'ivan', password: 'secret', remember: true })
    expect(r.success && r.data.remember).toBe(true)
  })
})

describe('changePasswordRequestSchema', () => {
  it('accepts a change to a distinct 8+ char password', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'old-secret',
      newPassword: 'brand-new-secret',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a new password shorter than 8 chars', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'old-secret',
      newPassword: 'short',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a new password equal to the current one', () => {
    const r = changePasswordRequestSchema.safeParse({
      currentPassword: 'same-secret',
      newPassword: 'same-secret',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'newPassword')).toBe(true)
    }
  })
})
