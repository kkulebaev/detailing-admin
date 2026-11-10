import { describe, expect, it } from 'vitest'
import { isSafeRedirect } from '@/lib/safe-redirect'

describe('isSafeRedirect', () => {
  it('принимает локальный путь', () => {
    expect(isSafeRedirect('/clients')).toBe(true)
  })

  it('принимает локальный путь с query-строкой', () => {
    expect(isSafeRedirect('/clients?tab=active')).toBe(true)
  })

  it('отклоняет protocol-relative URL (//host)', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false)
  })

  it('отклоняет URL с обратным слешем в начале (/\\host)', () => {
    expect(isSafeRedirect('/\\evil.com')).toBe(false)
  })

  it('отклоняет путь без ведущего слеша', () => {
    expect(isSafeRedirect('evil.com')).toBe(false)
  })

  it('отклоняет абсолютный URL', () => {
    expect(isSafeRedirect('https://evil.com')).toBe(false)
  })
})
