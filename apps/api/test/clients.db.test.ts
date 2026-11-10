import { describe, it, expect, afterEach, vi } from 'vitest'

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

// Изолируем логику строки клиента: syncClientCars/listCarsByClient проверяются
// в client-cars.db.test.ts. Здесь лишь убеждаемся, что createClient/updateClient
// передают машины дальше и возвращают сверенный набор, который отдает слой машин.
vi.mock('../src/db/client-cars.js', () => ({
  syncClientCars: vi.fn().mockResolvedValue(undefined),
  listCarsByClient: vi.fn().mockResolvedValue([]),
}))

import { PgDialect } from 'drizzle-orm/pg-core'
import { _setDbForTest, type Db } from '../src/db/client.js'
import {
  deleteClient,
  createClient,
  updateClient,
  getClientStats,
  listClients,
  ClientError,
} from '../src/db/clients.js'
import { syncClientCars, listCarsByClient } from '../src/db/client-cars.js'

// Минимальный thenable-фейк query builder. `deleteClient` выполняет `select`
// (проверку ссылок из записей), а затем `delete`; обе очереди разбираются в
// порядке вызовов, повторяя цепочку в коде.
function makeFakeDb(opts: { selectResults: unknown[]; deleteResults: unknown[] }): Db {
  const selectQ = [...opts.selectResults]
  const deleteQ = [...opts.deleteResults]

  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    c.from = passthrough
    c.where = passthrough
    c.limit = passthrough
    c.returning = passthrough
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej)
    return c
  }

  return {
    select: () => chain(() => selectQ.shift()),
    delete: () => chain(() => deleteQ.shift()),
  } as unknown as Db
}

const CLIENT_ID = 'f233cc73-2f2b-4e6b-8f9a-c3d81f2df450'

afterEach(() => {
  _setDbForTest(null)
})

describe('deleteClient', () => {
  it('бросает has_bookings, если на клиента еще ссылается запись', async () => {
    // Проверка нашла связанную запись → отказываем, не пытаясь удалить.
    _setDbForTest(makeFakeDb({ selectResults: [[{ id: 'booking-1' }]], deleteResults: [] }))

    await expect(deleteClient(CLIENT_ID)).rejects.toMatchObject({
      constructor: ClientError,
      code: 'has_bookings',
    })
  })

  it('бросает not_found, если клиента нет', async () => {
    _setDbForTest(makeFakeDb({ selectResults: [[]], deleteResults: [[]] }))

    await expect(deleteClient(CLIENT_ID)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('завершается успешно, если у клиента нет записей и он удален', async () => {
    _setDbForTest(makeFakeDb({ selectResults: [[]], deleteResults: [[{ id: CLIENT_ID }]] }))

    await expect(deleteClient(CLIENT_ID)).resolves.toBeUndefined()
  })
})

// Фейк цепочки для select/insert/update; каждый глагол разбирает свою очередь
// результатов в порядке вызовов.
function makeMutationDb(opts: {
  selectResults?: unknown[]
  insertResults?: unknown[]
  updateResults?: unknown[]
}): Db {
  const selectQ = [...(opts.selectResults ?? [])]
  const insertQ = [...(opts.insertResults ?? [])]
  const updateQ = [...(opts.updateResults ?? [])]

  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    c.from = passthrough
    c.where = passthrough
    c.limit = passthrough
    c.set = passthrough
    c.values = passthrough
    c.returning = passthrough
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(res, rej)
    return c
  }

  return {
    select: () => chain(() => selectQ.shift()),
    insert: () => chain(() => insertQ.shift()),
    update: () => chain(() => updateQ.shift()),
  } as unknown as Db
}

const ROW = {
  id: CLIENT_ID,
  phone: '+79001234567',
  name: 'Иван',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
}
const CAR = { id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА77' }

describe('createClient', () => {
  it('бросает duplicate_phone, если такой телефон уже есть', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[{ id: 'other' }]] }))

    await expect(createClient('+79001234567', 'Иван', [])).rejects.toMatchObject({
      constructor: ClientError,
      code: 'duplicate_phone',
    })
  })

  it('вставляет клиента, синхронизирует машины и возвращает сверенный набор', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[]], insertResults: [[ROW]] }))
    vi.mocked(listCarsByClient).mockResolvedValueOnce([CAR])

    const result = await createClient('+79001234567', 'Иван', [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])

    expect(result).toEqual({ client: ROW, cars: [CAR] })
    expect(vi.mocked(syncClientCars)).toHaveBeenCalledWith(CLIENT_ID, [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
  })
})

describe('getClientStats', () => {
  it('для клиента без строк «Выдана» отдает нули/null', async () => {
    // Условие «Выдана» не дает строк → агрегат равен 0/0/null/null.
    _setDbForTest(
      makeFakeDb({
        selectResults: [[{ totalSpent: '0', visitCount: '0', lastVisit: null, firstVisit: null }]],
        deleteResults: [],
      }),
    )

    await expect(getClientStats(CLIENT_ID)).resolves.toEqual({
      totalSpent: 0,
      visitCount: 0,
      lastVisit: null,
      firstVisit: null,
    })
  })

  it('приводит строковые агрегаты postgres к числам, даты проходят как есть', async () => {
    _setDbForTest(
      makeFakeDb({
        selectResults: [
          [
            {
              totalSpent: '15000',
              visitCount: '3',
              lastVisit: '2026-06-10',
              firstVisit: '2026-01-05',
            },
          ],
        ],
        deleteResults: [],
      }),
    )

    await expect(getClientStats(CLIENT_ID)).resolves.toEqual({
      totalSpent: 15000,
      visitCount: 3,
      lastVisit: '2026-06-10',
      firstVisit: '2026-01-05',
    })
  })
})

describe('updateClient', () => {
  it('бросает duplicate_phone, если телефон принадлежит другому клиенту', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[{ id: 'other' }]] }))

    await expect(updateClient(CLIENT_ID, '+79001234567', 'Иван', [])).rejects.toMatchObject({
      code: 'duplicate_phone',
    })
  })

  it('бросает not_found, если строки нет', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[]], updateResults: [[]] }))

    await expect(updateClient(CLIENT_ID, '+79001234567', 'Иван', [])).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('обновляет клиента, заменяет машины и возвращает сверенный набор', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[]], updateResults: [[ROW]] }))
    vi.mocked(listCarsByClient).mockResolvedValueOnce([CAR])

    const result = await updateClient(CLIENT_ID, '+79001234567', 'Иван', [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])

    expect(result).toEqual({ client: ROW, cars: [CAR] })
    expect(vi.mocked(syncClientCars)).toHaveBeenCalledWith(CLIENT_ID, [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
  })
})

// Фейк цепочки для чтения: каждый глагол возвращает `this`, каждый await в конце
// забирает следующий результат, а `.where()` запоминает условие. Для списка
// сначала идут элементы, потом count — оба с одним и тем же условием.
function makeListDb(selectResults: unknown[], captured: unknown[]): Db {
  const q = [...selectResults]
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: (w: unknown) => {
      captured.push(w)
      return chain
    },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    then: (res: (v: unknown) => unknown) => res(q.shift() ?? []),
  }
  return chain as unknown as Db
}

// Ветка поиска определяет форму where, поэтому проверяем сгенерированный SQL,
// а не строки, которые фейковой БД пришлось бы выдумывать.
const renderWhere = (captured: unknown[]) =>
  captured.filter((c) => c !== undefined).map((c) => new PgDialect().sqlToQuery(c as never))

describe('поиск в listClients', () => {
  it('ищет по марке/модели и номеру в client_cars наряду с именем и телефоном', async () => {
    const captured: unknown[] = []
    _setDbForTest(makeListDb([[], [{ count: 0 }]], captured))

    await listClients({ limit: 10, offset: 0, q: 'Camry' })

    const [where] = renderWhere(captured)
    expect(where.sql).toMatch(/exists/i)
    expect(where.sql).toContain('client_cars')
    expect(where.sql).toContain('"make_model"')
    expect(where.sql).toContain('"plate"')
    expect(where.params).toContain('%Camry%')
  })

  it('нормализует похожий на номер запрос так же, как он хранится в client_cars', async () => {
    const captured: unknown[] = []
    _setDbForTest(makeListDb([[], [{ count: 0 }]], captured))

    await listClients({ limit: 10, offset: 0, q: 'а 123 аа 77' })

    const [where] = renderWhere(captured)
    // Номера хранятся в верхнем регистре и без пробелов; марка/модель сохраняет
    // пробелы (лишь схлопнутые), поэтому должны присутствовать оба шаблона.
    expect(where.params).toContain('%А123АА77%')
    expect(where.params).toContain('%а 123 аа 77%')
  })

  it('не строит where без поискового запроса', async () => {
    const captured: unknown[] = []
    _setDbForTest(makeListDb([[], [{ count: 0 }]], captured))

    await listClients({ limit: 10, offset: 0 })

    expect(captured[0]).toBeUndefined()
  })
})
