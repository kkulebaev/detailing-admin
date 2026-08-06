import { describe, expect, it } from 'vitest'
import { bookingsExportUrl } from '@/lib/bookings-api'
import { clientsExportUrl } from '@/lib/clients-api'

describe('bookingsExportUrl', () => {
  it('includes the current filters and excludes paging (limit/offset)', () => {
    const url = bookingsExportUrl({
      limit: 100,
      offset: 200,
      dateFrom: '01.08.2026',
      dateTo: '31.08.2026',
      master: 'Иван',
      readiness: 'Выдана',
      q: '+7999',
    })
    const qs = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith('/api/bookings/export?')).toBe(true)
    expect(qs.get('dateFrom')).toBe('01.08.2026')
    expect(qs.get('dateTo')).toBe('31.08.2026')
    expect(qs.get('master')).toBe('Иван')
    expect(qs.get('readiness')).toBe('Выдана')
    expect(qs.get('q')).toBe('+7999')
    expect(qs.has('limit')).toBe(false)
    expect(qs.has('offset')).toBe(false)
  })

  it('drops undefined filters', () => {
    const url = bookingsExportUrl({ limit: 100, offset: 0, master: 'Пётр' })
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('master')).toBe('Пётр')
    expect(qs.has('dateFrom')).toBe(false)
    expect(qs.has('q')).toBe(false)
  })

  it('returns a bare path when no filters are set', () => {
    expect(bookingsExportUrl({ limit: 100, offset: 0 })).toBe('/api/bookings/export')
  })
})

describe('clientsExportUrl', () => {
  it('includes q/sort/dir and excludes paging (limit/offset)', () => {
    const url = clientsExportUrl({
      limit: 100,
      offset: 50,
      q: 'Иван',
      sort: 'name',
      dir: 'desc',
    })
    const qs = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith('/api/clients/export?')).toBe(true)
    expect(qs.get('q')).toBe('Иван')
    expect(qs.get('sort')).toBe('name')
    expect(qs.get('dir')).toBe('desc')
    expect(qs.has('limit')).toBe(false)
    expect(qs.has('offset')).toBe(false)
  })

  it('drops a null offset without emitting "null"', () => {
    const url = clientsExportUrl({ limit: 100, offset: null, sort: 'name', dir: 'asc' })
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.has('offset')).toBe(false)
    expect(url).not.toContain('null')
  })
})
