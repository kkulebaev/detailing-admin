import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
  },
}))

import { PgDialect } from 'drizzle-orm/pg-core'
import { _setDbForTest, type Db } from '../src/db/client.js'
import {
  createMaster,
  deleteMaster,
  reorderMasters,
  resolveMasterIds,
  updateMaster,
  MasterError,
} from '../src/db/masters.js'

// Минимальный thenable-фейк query builder. Терминальные методы отдают результат
// из очереди; payload'ы `.set()` / `.values()` сохраняются для проверок. Результаты
// разбираются в порядке вызовов, поэтому тесты заполняют их под цепочки в коде.
interface Capture {
  sets: Array<Record<string, unknown>>
  values: Array<Record<string, unknown>>
}

function makeFakeDb(opts: {
  selectResults: unknown[]
  updateResults?: unknown[]
  insertResults?: unknown[]
}): { db: Db; capture: Capture } {
  const selectQ = [...opts.selectResults]
  const updateQ = [...(opts.updateResults ?? [])]
  const insertQ = [...(opts.insertResults ?? [])]
  const capture: Capture = { sets: [], values: [] }

  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    c.from = passthrough
    c.where = passthrough
    c.orderBy = passthrough
    c.limit = passthrough
    c.returning = passthrough
    c.set = (v: Record<string, unknown>) => {
      capture.sets.push(v)
      return c
    }
    c.values = (v: Record<string, unknown>) => {
      capture.values.push(v)
      return c
    }
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej)
    return c
  }

  const db = {
    select: () => chain(() => selectQ.shift()),
    update: () => chain(() => updateQ.shift()),
    insert: () => chain(() => insertQ.shift()),
    delete: () => chain(() => []),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Db

  return { db, capture }
}

afterEach(() => {
  _setDbForTest(null)
})

describe('createMaster (T2)', () => {
  it('бросает duplicate_name, если такое имя уже есть', async () => {
    const { db } = makeFakeDb({ selectResults: [[{ id: 1 }]] })
    _setDbForTest(db)

    await expect(
      createMaster({
        name: 'Иван Содель',
        canBeResponsible: true,
        paidSalary: true,
        telegramId: null,
        userId: null,
      }),
    ).rejects.toBeInstanceOf(MasterError)
  })

  it('вставляет новую строку с position=max+1, если имя еще не встречалось', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [
        [], // существующей строки нет
        [{ max: 4 }], // nextPosition
      ],
      insertResults: [
        [
          {
            id: 9,
            name: 'Новый Мастер',
            position: 5,
            canBeResponsible: true,
            paidSalary: true,
            telegramId: null,
          },
        ],
      ],
    })
    _setDbForTest(db)

    const row = await createMaster({
      name: 'Новый Мастер',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: null,
      userId: null,
    })

    expect(row.id).toBe(9)
    expect(capture.values[0]).toMatchObject({
      name: 'Новый Мастер',
      position: 5,
      canBeResponsible: true,
      telegramId: null,
    })
  })

  it('сохраняет переданный telegramId при вставке', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [
        [], // существующей строки нет
        [{ max: 0 }], // nextPosition
      ],
      insertResults: [
        [
          {
            id: 10,
            name: 'Петр',
            position: 1,
            canBeResponsible: true,
            paidSalary: true,
            telegramId: '777',
          },
        ],
      ],
    })
    _setDbForTest(db)

    const row = await createMaster({
      name: 'Петр',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: '777',
      userId: null,
    })

    expect(row.telegramId).toBe('777')
    expect(capture.values[0]).toMatchObject({ telegramId: '777' })
  })
})

describe('привязка аккаунта', () => {
  const userId = '0b3c6f0e-6f8b-4a8e-9d2f-1c2b3a4d5e6f'
  const input = { name: 'Петр', canBeResponsible: true, paidSalary: true, telegramId: null, userId }

  it('бросает unknown_user, если аккаунта нет', async () => {
    // проверка имени → свободно; проверка пользователя → не найден.
    const { db } = makeFakeDb({ selectResults: [[], []] })
    _setDbForTest(db)

    const err = await createMaster(input).catch((e) => e)
    expect(err).toBeInstanceOf(MasterError)
    expect(err.code).toBe('unknown_user')
  })

  it('бросает duplicate_user, если аккаунт уже занят другим мастером', async () => {
    // проверка имени → свободно; пользователь есть; привязан к мастеру 2.
    const { db } = makeFakeDb({ selectResults: [[], [{ id: userId }], [{ id: 2 }]] })
    _setDbForTest(db)

    const err = await createMaster(input).catch((e) => e)
    expect(err).toBeInstanceOf(MasterError)
    expect(err.code).toBe('duplicate_user')
  })

  it('позволяет мастеру сохранить свой аккаунт при обновлении', async () => {
    // проверка имени → он сам; пользователь есть; привязан к этому же мастеру.
    const { db, capture } = makeFakeDb({
      selectResults: [[{ id: 1 }], [{ id: userId }], [{ id: 1 }]],
      updateResults: [[{ id: 1, ...input }]],
    })
    _setDbForTest(db)

    await updateMaster(1, input)
    expect(capture.sets[0]).toMatchObject({ userId })
  })

  it('пропускает проверки при отвязке', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [[]],
      updateResults: [[{ id: 1, ...input, userId: null }]],
    })
    _setDbForTest(db)

    await updateMaster(1, { ...input, userId: null })
    expect(capture.sets[0]).toMatchObject({ userId: null })
  })
})

describe('deleteMaster', () => {
  it('архивирует строку и освобождает аккаунт вместо удаления', async () => {
    const { db, capture } = makeFakeDb({ selectResults: [], updateResults: [[{ id: 1 }]] })
    _setDbForTest(db)
    await deleteMaster(1)
    expect(capture.sets).toEqual([{ archived: true, userId: null }])
  })

  it('бросает not_found, если мастера нет или он уже в архиве', async () => {
    const { db } = makeFakeDb({ selectResults: [], updateResults: [[]] })
    _setDbForTest(db)
    await expect(deleteMaster(1)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('имя, занятое архивным мастером', () => {
  const input = {
    name: 'Петр',
    canBeResponsible: true,
    paidSalary: true,
    telegramId: null,
    userId: null,
  }

  it('отклоняется с archived_name при создании', async () => {
    const { db } = makeFakeDb({ selectResults: [[{ id: 7, archived: true }]] })
    _setDbForTest(db)
    await expect(createMaster(input)).rejects.toMatchObject({ code: 'archived_name' })
  })

  it('отклоняется с archived_name при переименовании', async () => {
    const { db } = makeFakeDb({ selectResults: [[{ id: 7, archived: true }]] })
    _setDbForTest(db)
    await expect(updateMaster(1, { name: 'Петр' })).rejects.toMatchObject({ code: 'archived_name' })
  })
})

describe('resolveMasterIds', () => {
  // Запоминает условие `where` (чтобы проверить параметры) и отдает на select
  // строки из очереди. `throwingDb` доказывает, что при пустом вводе ранний выход
  // не трогает БД.
  function resolverDb(rows: { id: number; name: string }[], captured: unknown[] = []): Db {
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      where: (w: unknown) => {
        captured.push(w)
        return chain
      },
      then: (res: (v: unknown) => unknown) => res(rows),
    }
    return chain as unknown as Db
  }

  it('сопоставляет с id только найденную часть имен', async () => {
    _setDbForTest(resolverDb([{ id: 1, name: 'Петр' }]))
    const map = await resolveMasterIds(['Петр', 'Неизвестный'])
    expect(map.get('Петр')).toBe(1)
    expect(map.has('Неизвестный')).toBe(false)
    expect(map.size).toBe(1)
  })

  it('для пустого ввода возвращает пустой map без запроса', async () => {
    // БД, у которой select бросает, — доказывает, что ранний выход срабатывает до запроса.
    const throwingDb = {
      select: () => {
        throw new Error('should not query on empty input')
      },
    } as unknown as Db
    _setDbForTest(throwingDb)
    const map = await resolveMasterIds([])
    expect(map.size).toBe(0)
  })

  it('возвращает пустой map, если после отсева имен из одних пробелов ничего не осталось', async () => {
    const throwingDb = {
      select: () => {
        throw new Error('should not query when nothing to look up')
      },
    } as unknown as Db
    _setDbForTest(throwingDb)
    const map = await resolveMasterIds(['   ', ''])
    expect(map.size).toBe(0)
  })

  it('обрезает пробелы и убирает дубли имен до запроса (один параметр на уникальное имя)', async () => {
    const captured: unknown[] = []
    _setDbForTest(resolverDb([{ id: 5, name: 'Костя' }], captured))
    await resolveMasterIds(['  Костя  ', 'Костя'])
    const rendered = new PgDialect().sqlToQuery(captured[0] as never)
    // Оба значения схлопываются в одно обрезанное «Костя».
    expect(rendered.params).toEqual(['Костя'])
  })
})

describe('инвариант reorderMasters (T3)', () => {
  it('отклоняет набор, не совпадающий с полным набором id', async () => {
    const { db } = makeFakeDb({
      selectResults: [[{ id: 1 }, { id: 2 }, { id: 3 }]], // существующие id
    })
    _setDbForTest(db)

    const err = await reorderMasters([1, 2]).catch((e) => e)
    expect(err).toBeInstanceOf(MasterError)
    expect(err.code).toBe('invalid_order')
  })

  it('для полного набора назначает плотные позиции 0..n-1 в присланном порядке', async () => {
    const final = [
      { id: 2, name: 'b', position: 0, canBeResponsible: true, paidSalary: true, telegramId: null },
      { id: 1, name: 'a', position: 1, canBeResponsible: true, paidSalary: true, telegramId: null },
    ]
    const { db, capture } = makeFakeDb({
      selectResults: [
        [{ id: 1 }, { id: 2 }], // существующие id
        final, // итоговый упорядоченный список
      ],
      updateResults: [[], []],
    })
    _setDbForTest(db)

    const rows = await reorderMasters([2, 1])
    expect(rows).toEqual(final)
    // Позиции назначены плотно в присланном порядке.
    expect(capture.sets).toEqual([{ position: 0 }, { position: 1 }])
  })
})
