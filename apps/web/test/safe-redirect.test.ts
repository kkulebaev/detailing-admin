import { describe, expect, it } from 'vitest'
import { isSafeRedirect } from '@/lib/safe-redirect'

describe('isSafeRedirect', () => {
  it('accepts a local path', () => {
    expect(isSafeRedirect('/clients')).toBe(true)
  })

  it('accepts a local path with a query string', () => {
    expect(isSafeRedirect('/clients?tab=active')).toBe(true)
  })

  it('rejects a protocol-relative URL (//host)', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false)
  })

  it('rejects a backslash-prefixed URL (/\\host)', () => {
    expect(isSafeRedirect('/\\evil.com')).toBe(false)
  })

  it('rejects a path with no leading slash', () => {
    expect(isSafeRedirect('evil.com')).toBe(false)
  })

  it('rejects an absolute URL', () => {
    expect(isSafeRedirect('https://evil.com')).toBe(false)
  })
})
