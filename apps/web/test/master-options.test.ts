import { describe, expect, it } from 'vitest'
import type { Master } from '@detailing-admin/shared'
import { resolveMasterOptions } from '@/lib/master-options'

function master(overrides: Partial<Master>): Master {
  return {
    id: 1,
    name: 'Тест',
    position: 0,
    canBeResponsible: true,
    paidSalary: true,
    telegramId: null,
    userId: null,
    ...overrides,
  }
}

const ALWAYS = () => true

describe('resolveMasterOptions', () => {
  it('возвращает пустой список, если data не определена', () => {
    expect(resolveMasterOptions(undefined, ALWAYS)).toEqual([])
  })

  it('возвращает пустой список, если исходный список пуст', () => {
    expect(resolveMasterOptions([], ALWAYS)).toEqual([])
  })

  it('возвращает все имена, если фильтр пропускает всех', () => {
    const rows = [
      master({ id: 1, name: 'Первый' }),
      master({ id: 2, name: 'Второй' }),
      master({ id: 3, name: 'Третий' }),
    ]
    expect(resolveMasterOptions(rows, ALWAYS)).toEqual(['Первый', 'Второй', 'Третий'])
  })

  it('исключает строки, где canBeResponsible равно false', () => {
    const rows = [
      master({ id: 1, name: 'Ответственный', canBeResponsible: true }),
      master({ id: 2, name: 'Не ответственный', canBeResponsible: false }),
    ]
    expect(resolveMasterOptions(rows, (m) => m.canBeResponsible)).toEqual(['Ответственный'])
  })

  it('возвращает пустой список, если фильтр по роли исключает всех', () => {
    const rows = [
      master({ id: 1, name: 'А', canBeResponsible: false }),
      master({ id: 2, name: 'Б', canBeResponsible: false }),
    ]
    expect(resolveMasterOptions(rows, (m) => m.canBeResponsible)).toEqual([])
  })
})
