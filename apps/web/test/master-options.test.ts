import { describe, expect, it } from 'vitest'
import { MASTERS, type Master } from '@detailing-admin/shared'
import { resolveMasterOptions } from '@/lib/master-options'

function master(overrides: Partial<Master>): Master {
  return {
    id: 1,
    name: 'Тест',
    position: 0,
    canBeResponsible: true,
    telegramId: null,
    ...overrides,
  }
}

const ALWAYS = () => true

describe('resolveMasterOptions', () => {
  it('falls back to MASTERS when data is undefined', () => {
    expect(resolveMasterOptions(undefined, ALWAYS)).toEqual([...MASTERS])
  })

  it('falls back to MASTERS when the list is empty', () => {
    expect(resolveMasterOptions([], ALWAYS)).toEqual([...MASTERS])
  })

  it('returns every name when the filter always passes', () => {
    const rows = [
      master({ id: 1, name: 'Первый' }),
      master({ id: 2, name: 'Второй' }),
      master({ id: 3, name: 'Третий' }),
    ]
    expect(resolveMasterOptions(rows, ALWAYS)).toEqual(['Первый', 'Второй', 'Третий'])
  })

  it('excludes rows where canBeResponsible is false', () => {
    const rows = [
      master({ id: 1, name: 'Ответственный', canBeResponsible: true }),
      master({ id: 2, name: 'Не ответственный', canBeResponsible: false }),
    ]
    expect(resolveMasterOptions(rows, (m) => m.canBeResponsible)).toEqual(['Ответственный'])
  })

  it('falls back to MASTERS when the role filter excludes everyone', () => {
    const rows = [
      master({ id: 1, name: 'А', canBeResponsible: false }),
      master({ id: 2, name: 'Б', canBeResponsible: false }),
    ]
    expect(resolveMasterOptions(rows, (m) => m.canBeResponsible)).toEqual([...MASTERS])
  })
})
