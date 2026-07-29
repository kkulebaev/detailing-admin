import { describe, expect, it } from 'vitest'
import {
  ROLES,
  changePasswordRequestSchema,
  loginRequestSchema,
  roleSchema,
} from '../src/auth.js'

describe('roleSchema', () => {
  it('accepts the two known roles', () => {
    expect(roleSchema.parse('admin')).toBe('admin')
    expect(roleSchema.parse('employee')).toBe('employee')
  })

  it('rejects unknown roles', () => {
    expect(roleSchema.safeParse('superuser').success).toBe(false)
  })

  it('ROLES is the single source of the enum', () => {
    expect([...ROLES]).toEqual(['admin', 'employee'])
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
