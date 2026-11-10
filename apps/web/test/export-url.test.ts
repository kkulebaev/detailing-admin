import { describe, expect, it } from 'vitest'
import { bookingsExportUrl } from '@/lib/bookings-api'
import { clientsExportUrl } from '@/lib/clients-api'

describe('bookingsExportUrl', () => {
  it('включает текущие фильтры и исключает пагинацию (limit/offset)', () => {
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

  it('отбрасывает неопределенные фильтры', () => {
    const url = bookingsExportUrl({ limit: 100, offset: 0, master: 'Петр' })
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('master')).toBe('Петр')
    expect(qs.has('dateFrom')).toBe(false)
    expect(qs.has('q')).toBe(false)
  })

  it('возвращает голый путь, если фильтры не заданы', () => {
    expect(bookingsExportUrl({ limit: 100, offset: 0 })).toBe('/api/bookings/export')
  })
})

describe('clientsExportUrl', () => {
  it('включает q/sort/dir и исключает пагинацию (limit/offset)', () => {
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

  it('отбрасывает null-offset, не выводя «null»', () => {
    const url = clientsExportUrl({ limit: 100, offset: null, sort: 'name', dir: 'asc' })
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.has('offset')).toBe(false)
    expect(url).not.toContain('null')
  })
})
