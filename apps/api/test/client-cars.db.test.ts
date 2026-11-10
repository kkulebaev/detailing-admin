import { describe, it, expect, afterEach, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

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

import { _setDbForTest, type Db } from '../src/db/client.js'
import {
  upsertClientCar,
  upsertClientCarReturningId,
  selectCarId,
  listCarsByClientIds,
  syncClientCars,
} from '../src/db/client-cars.js'

const CLIENT_ID = 'f233cc73-2f2b-4e6b-8f9a-c3d81f2df450'

afterEach(() => {
  _setDbForTest(null)
})

// Фейковая цепочка insert: insert().values(v).onConflictDoNothing(opts).returning() —
// запоминает values/цель конфликта и резолвится в `returningRows` (по умолчанию новый
// id, так что ветка select-fallback в upsert не задействуется).
function makeInsertDb(returningRows: unknown[] = [{ id: 'new-car-id' }]) {
  const captured: { values?: Record<string, unknown>; conflict?: unknown } = {}
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      captured.values = v
      return {
        onConflictDoNothing: (opts: unknown) => {
          captured.conflict = opts
          return { returning: () => Promise.resolve(returningRows) }
        },
      }
    },
  }))
  return { db: { insert } as unknown as Db, insert, captured }
}

// Фейковая цепочка select: select({...}).from(t).where(cond) резолвится в заданные строки.
function makeSelectDb(rows: unknown[]) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(rows) }),
  }))
  return { db: { select } as unknown as Db, select }
}

// Фейковая БД «insert, затем select» для конфликтной ветки upsertClientCarReturningId:
// insert не возвращает строку (конфликт), а select-fallback находит существующий id.
// Запоминает предикат where, чтобы можно было проверить нормализованный ключ поиска.
function makeUpsertConflictDb(selectRows: unknown[]) {
  const captured: { insertValues?: Record<string, unknown>; selectWhere?: unknown } = {}
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      captured.insertValues = v
      return {
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }
    },
  }))
  const select = vi.fn(() => ({
    from: () => ({
      where: (cond: unknown) => {
        captured.selectWhere = cond
        return { limit: () => Promise.resolve(selectRows) }
      },
    }),
  }))
  return { db: { insert, select } as unknown as Db, insert, select, captured }
}

// Фейковая цепочка select с limit для selectCarId: select().from().where(cond)
// .limit(n) резолвится в заданные строки; запоминает предикат where.
function makeSelectLimitDb(rows: unknown[]) {
  const captured: { where?: unknown } = {}
  const select = vi.fn(() => ({
    from: () => ({
      where: (cond: unknown) => {
        captured.where = cond
        return { limit: () => Promise.resolve(rows) }
      },
    }),
  }))
  return { db: { select } as unknown as Db, select, captured }
}

describe('upsertClientCar', () => {
  it('вставляет нормализованные марку/модель и номер', async () => {
    const { db, captured } = makeInsertDb()
    _setDbForTest(db)

    await upsertClientCar(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(captured.values).toMatchObject({
      clientId: CLIENT_ID,
      makeModel: 'Toyota Camry',
      plate: 'А123АА77',
    })
  })

  it('ничего не делает (без insert) при пустой марке/модели', async () => {
    const { db, insert } = makeInsertDb()
    _setDbForTest(db)

    await upsertClientCar(CLIENT_ID, '   ', 'А123АА77')

    expect(insert).not.toHaveBeenCalled()
  })

  it('дедуплицирует через onConflictDoNothing по уникальному ключу (clientId, makeModel, plate)', async () => {
    const { db, captured } = makeInsertDb()
    _setDbForTest(db)

    await upsertClientCar(CLIENT_ID, 'Toyota Camry', '')

    // Пустой номер хранится как '' (никогда не NULL), чтобы UNIQUE-индекс его дедуплицировал.
    expect(captured.values).toMatchObject({ plate: '' })
    expect(captured.conflict).toMatchObject({ target: expect.any(Array) })
  })
})

describe('upsertClientCarReturningId', () => {
  it('возвращает новый id, когда insert добавляет новую строку', async () => {
    const { db, captured } = makeInsertDb([{ id: 'fresh-car-id' }])
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(id).toBe('fresh-car-id')
    // Нормализуется до insert (марка/модель схлопнута, номер в верхнем регистре и без пробелов).
    expect(captured.values).toMatchObject({
      clientId: CLIENT_ID,
      makeModel: 'Toyota Camry',
      plate: 'А123АА77',
    })
  })

  it('при конфликте берёт существующий id, сопоставляя по тому же нормализованному ключу', async () => {
    const { db, captured } = makeUpsertConflictDb([{ id: 'existing-car-id' }])
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(id).toBe('existing-car-id')
    // Insert записал нормализованные значения…
    expect(captured.insertValues).toMatchObject({ makeModel: 'Toyota Camry', plate: 'А123АА77' })
    // …и select-fallback идёт по тем же нормализованным колонкам (иначе id никогда
    // не нашёлся бы). Отрендеренный SQL несёт нормализованные параметры.
    const rendered = new PgDialect().sqlToQuery(captured.selectWhere as never)
    expect(rendered.params).toContain('Toyota Camry')
    expect(rendered.params).toContain('А123АА77')
    expect(rendered.params).toContain(CLIENT_ID)
  })

  it('возвращает null при пустой марке/модели, не обращаясь к БД', async () => {
    const { db, insert } = makeInsertDb()
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, '   ', 'А123АА77')

    expect(id).toBeNull()
    expect(insert).not.toHaveBeenCalled()
  })

  it('возвращает null, если select после конфликта ничего не находит', async () => {
    const { db } = makeUpsertConflictDb([])
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, 'Toyota Camry', '')
    expect(id).toBeNull()
  })
})

describe('selectCarId', () => {
  it('возвращает id машины, уже лежащей в client_cars (только чтение, нормализованный ключ)', async () => {
    const { db, captured, select } = makeSelectLimitDb([{ id: 'existing-car-id' }])
    _setDbForTest(db)

    const id = await selectCarId(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(id).toBe('existing-car-id')
    expect(select).toHaveBeenCalledTimes(1)
    const rendered = new PgDialect().sqlToQuery(captured.where as never)
    expect(rendered.params).toContain('Toyota Camry')
    expect(rendered.params).toContain('А123АА77')
    expect(rendered.params).toContain(CLIENT_ID)
  })

  it('возвращает null, если ни одна машина не подходит', async () => {
    const { db } = makeSelectLimitDb([])
    _setDbForTest(db)

    expect(await selectCarId(CLIENT_ID, 'Kia Rio', '')).toBeNull()
  })

  it('возвращает null при пустой марке/модели без запроса (никогда не вставляет)', async () => {
    const { db, select } = makeSelectLimitDb([{ id: 'x' }])
    _setDbForTest(db)

    const id = await selectCarId(CLIENT_ID, '  ', 'А123АА77')
    expect(id).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })
})

describe('listCarsByClientIds', () => {
  it('группирует машины по clientId', async () => {
    const rows = [
      { id: 'car-1', clientId: 'a', makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { id: 'car-2', clientId: 'a', makeModel: 'BMW X5', plate: '' },
      { id: 'car-3', clientId: 'b', makeModel: 'Kia Rio', plate: 'В001ВВ99' },
    ]
    const { db } = makeSelectDb(rows)
    _setDbForTest(db)

    const map = await listCarsByClientIds(['a', 'b'])

    expect(map.get('a')).toEqual([
      { id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { id: 'car-2', makeModel: 'BMW X5', plate: '' },
    ])
    expect(map.get('b')).toEqual([{ id: 'car-3', makeModel: 'Kia Rio', plate: 'В001ВВ99' }])
  })

  it('возвращает пустую map без запроса при пустом списке id', async () => {
    const { db, select } = makeSelectDb([])
    _setDbForTest(db)

    const map = await listCarsByClientIds([])

    expect(map.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })
})

// Фейковая транзакция для syncClientCars: select() → существующие строки; delete().where()
// и insert().values().onConflictDoNothing() запоминают свои аргументы. transaction()
// вызывает колбэк с этим же фейком (одного соединения достаточно).
function makeSyncDb(existing: { id: string; makeModel: string; plate: string }[]) {
  const captured: {
    deleteWhere: unknown
    insertValues: { clientId: string; makeModel: string; plate: string }[] | null
  } = { deleteWhere: undefined, insertValues: null }

  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(existing) }) }),
    delete: () => ({
      where: (cond: unknown) => {
        captured.deleteWhere = cond
        return Promise.resolve([])
      },
    }),
    insert: () => ({
      values: (v: { clientId: string; makeModel: string; plate: string }[]) => {
        captured.insertValues = v
        return { onConflictDoNothing: () => Promise.resolve([]) }
      },
    }),
  }
  const db = {
    transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as Db
  return { db, captured }
}

describe('syncClientCars', () => {
  it('вставляет недостающие нормализованные пары, когда у клиента их нет', async () => {
    const { db, captured } = makeSyncDb([])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [
      { makeModel: 'Toyota  Camry', plate: 'а 123 аа 77' },
      { makeModel: 'BMW X5', plate: '' },
    ])

    expect(captured.insertValues).toEqual([
      { clientId: CLIENT_ID, makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { clientId: CLIENT_ID, makeModel: 'BMW X5', plate: '' },
    ])
  })

  it('дедуплицирует пары, которые нормализуются в один ключ', async () => {
    const { db, captured } = makeSyncDb([])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { makeModel: 'Toyota  Camry', plate: 'а123аа77' },
    ])

    expect(captured.insertValues).toEqual([
      { clientId: CLIENT_ID, makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
  })

  it('пропускает записи с пустой маркой/моделью', async () => {
    const { db, captured } = makeSyncDb([])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [
      { makeModel: '   ', plate: 'А123АА77' },
      { makeModel: 'Kia Rio', plate: '' },
    ])

    expect(captured.insertValues).toEqual([
      { clientId: CLIENT_ID, makeModel: 'Kia Rio', plate: '' },
    ])
  })

  it('удаляет больше не нужные строки и сохраняет оставшиеся (без повторного insert)', async () => {
    // Оставляем Toyota, убираем BMW, добавляем Kia.
    const { db, captured } = makeSyncDb([
      { id: 'row-toyota', makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { id: 'row-bmw', makeModel: 'BMW X5', plate: '' },
    ])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { makeModel: 'Kia Rio', plate: '' },
    ])

    // Toyota остаётся → повторно не вставляется; вставляется только Kia.
    expect(captured.insertValues).toEqual([
      { clientId: CLIENT_ID, makeModel: 'Kia Rio', plate: '' },
    ])
    expect(captured.deleteWhere).toBeDefined()
  })

  it('идемпотентен: повторная синхронизация текущего набора ничего не вставляет и не удаляет', async () => {
    const { db, captured } = makeSyncDb([
      { id: 'row-toyota', makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }])

    expect(captured.insertValues).toBeNull()
    expect(captured.deleteWhere).toBeUndefined()
  })

  it('удаляет все строки, если передан пустой список', async () => {
    const { db, captured } = makeSyncDb([
      { id: 'row-toyota', makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [])

    expect(captured.insertValues).toBeNull()
    expect(captured.deleteWhere).toBeDefined()
  })
})
