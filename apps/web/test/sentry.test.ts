import { describe, expect, it } from 'vitest'
import { stripQuery } from '@/lib/sentry'

describe('stripQuery', () => {
  it('drops the query and the hash', () => {
    expect(stripQuery('https://x.app/bookings?search=%2B79990000000#top')).toBe(
      'https://x.app/bookings',
    )
    expect(stripQuery('/clients/5?tab=cars')).toBe('/clients/5')
  })

  it('keeps a url without a query', () => {
    expect(stripQuery('/api/bookings')).toBe('/api/bookings')
  })
})
