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

import { _setDbForTest, type Db } from '../src/db/client.js'
import {
  SalaryError,
  createPayout,
  createWorkHours,
  deletePayout,
  deleteWorkHours,
  listMasterEntries,
  listSalaries,
  setMasterRate,
  updatePayout,
  updateWorkHours,
} from '../src/db/salaries.js'

// Thenable-фейк query builder. Терминальные await забирают из `selectResults` в
// порядке вызовов; payload'ы `.set()`/`.values()` сохраняются для проверок.
// Методы подзапросов/join — сквозные: агрегатные SUM проверяются через итоговые
// строки после join в том виде, в каком их вернул бы Postgres (SUM строкой), так
// что здесь тестируются JS-маппинг и единственное округление.
interface Capture {
  sets: Array<Record<string, unknown>>
  values: Array<Record<string, unknown>>
}

function makeFakeDb(opts: {
  selectResults?: unknown[]
  updateResults?: unknown[]
  insertResults?: unknown[]
  deleteResults?: unknown[]
}): { db: Db; capture: Capture } {
  const selectQ = [...(opts.selectResults ?? [])]
  const updateQ = [...(opts.updateResults ?? [])]
  const insertQ = [...(opts.insertResults ?? [])]
  const deleteQ = [...(opts.deleteResults ?? [])]
  const capture: Capture = { sets: [], values: [] }

  const chain = (resolve: () => unknown) => {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    c.from = passthrough
    c.where = passthrough
    c.orderBy = passthrough
    c.groupBy = passthrough
    c.leftJoin = passthrough
    c.limit = passthrough
    c.returning = passthrough
    c.onConflictDoUpdate = passthrough
    // Алиас подзапроса — на его колонки ссылаются (agg.masterId, ...), но сквозной
    // select их игнорирует, так что подойдет любая заглушка.
    c.as = () => new Proxy({}, { get: () => ({}) })
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
    delete: () => chain(() => deleteQ.shift()),
  } as unknown as Db

  return { db, capture }
}

afterEach(() => {
  _setDbForTest(null)
})

describe('listSalaries — маппинг и единственное округление', () => {
  it('округляет итог за месяц один раз (нецелый случай): SUM=5000 ₽·мин → 83, а не 84', () => {
    // Две строки по 25 мин @100 ₽/ч в SQL агрегируются в minutes_rate_sum=5000. Если
    // делить в SQL как int/int, здесь по случайности отбросится дробь до 83, но
    // округление каждой строки дало бы 84. Единственное округление в JS дает 83.
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 1,
            masterName: 'Иван',
            hourlyRate: 100,
            totalMinutes: '50',
            minutesRateSum: '5000',
            payoutsSum: null,
          },
        ],
      ],
    })
    _setDbForTest(db)

    return listSalaries('2026-07').then((rows) => {
      expect(rows).toEqual([
        {
          masterId: 1,
          masterName: 'Иван',
          hourlyRate: 100,
          totalMinutes: 50,
          hoursSalary: 83,
          payoutsTotal: 0,
          total: 83,
        },
      ])
    })
  })

  it('суммирует по снимку ставки, если ставка поменялась в середине месяца', async () => {
    // 60мин@100 + 60мин@200 → SQL SUM(minutes*rate_snapshot)=18000 → 300 ₽,
    // независимо от ТЕКУЩЕЙ ставки мастера (здесь 200).
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 1,
            masterName: 'Иван',
            hourlyRate: 200,
            totalMinutes: '120',
            minutesRateSum: '18000',
            payoutsSum: null,
          },
        ],
      ],
    })
    _setDbForTest(db)

    const rows = await listSalaries('2026-07')
    expect(rows[0]).toMatchObject({
      totalMinutes: 120,
      hoursSalary: 300,
      payoutsTotal: 0,
      total: 300,
    })
  })

  it('оставляет мастеру без ставки (null) и без часов (агрегат null) зарплату 0', async () => {
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 2,
            masterName: 'Петр',
            hourlyRate: null,
            totalMinutes: null,
            minutesRateSum: null,
            payoutsSum: null,
          },
        ],
      ],
    })
    _setDbForTest(db)

    const rows = await listSalaries('2026-07')
    expect(rows[0]).toEqual({
      masterId: 2,
      masterName: 'Петр',
      hourlyRate: null,
      totalMinutes: 0,
      hoursSalary: 0,
      payoutsTotal: 0,
      total: 0,
    })
  })

  it('прибавляет агрегат выплат к почасовой части (отрицательная сумма вычитается)', async () => {
    // SUM(amount) за месяц приходит строкой, как и остальные агрегаты.
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 1,
            masterName: 'Иван',
            hourlyRate: 100,
            totalMinutes: '60',
            minutesRateSum: '6000',
            payoutsSum: '-2000',
          },
        ],
      ],
    })
    _setDbForTest(db)

    const rows = await listSalaries('2026-07')
    expect(rows[0]).toMatchObject({ hoursSalary: 100, payoutsTotal: -2000, total: -1900 })
  })
})

describe('setMasterRate', () => {
  it('бросает master_not_found, если мастера нет', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] })
    _setDbForTest(db)
    await expect(setMasterRate(999, 500)).rejects.toMatchObject({
      constructor: SalaryError,
      code: 'master_not_found',
    })
  })

  it('делает upsert ставки для существующего мастера', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [[{ id: 1 }]],
      insertResults: [[]],
    })
    _setDbForTest(db)
    await setMasterRate(1, 700)
    expect(capture.values[0]).toMatchObject({ masterId: 1, hourlyRate: 700 })
  })
})

describe('createWorkHours — снимок текущей ставки', () => {
  it('копирует текущую ставку мастера в rate_snapshot', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [[{ hourlyRate: 150 }]], // поиск текущей ставки
      insertResults: [
        [
          {
            id: 5,
            masterId: 1,
            workDate: '2026-07-10',
            minutes: 480,
            rateSnapshot: 150,
            note: '',
            createdAt: new Date(),
          },
        ],
      ],
    })
    _setDbForTest(db)

    const row = await createWorkHours({
      masterId: 1,
      workDate: '2026-07-10',
      minutes: 480,
      note: '',
    })
    expect(row.rateSnapshot).toBe(150)
    expect(capture.values[0]).toMatchObject({ masterId: 1, minutes: 480, rateSnapshot: 150 })
  })

  it('бросает no_rate, если у мастера нет строки ставки', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] })
    _setDbForTest(db)
    await expect(
      createWorkHours({ masterId: 1, workDate: '2026-07-10', minutes: 480, note: '' }),
    ).rejects.toMatchObject({ code: 'no_rate' })
  })
})

describe('updateWorkHours / deleteWorkHours', () => {
  it('обновляет день/минуты/заметку, не трогая снимок ставки', async () => {
    const { db, capture } = makeFakeDb({
      updateResults: [
        [
          {
            id: 5,
            masterId: 1,
            workDate: '2026-07-11',
            minutes: 300,
            rateSnapshot: 150,
            note: 'fix',
            createdAt: new Date(),
          },
        ],
      ],
    })
    _setDbForTest(db)

    await updateWorkHours(5, { workDate: '2026-07-11', minutes: 300, note: 'fix' })
    expect(capture.sets[0]).toEqual({ workDate: '2026-07-11', minutes: 300, note: 'fix' })
    expect(capture.sets[0]).not.toHaveProperty('rateSnapshot')
  })

  it('для пустого patch возвращает текущую строку (без .set({}))', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [
        [
          {
            id: 5,
            masterId: 1,
            workDate: '2026-07-11',
            minutes: 300,
            rateSnapshot: 150,
            note: '',
            createdAt: new Date(),
          },
        ],
      ],
    })
    _setDbForTest(db)

    const row = await updateWorkHours(5, {})
    expect(row.id).toBe(5)
    expect(capture.sets).toHaveLength(0)
  })

  it('бросает not_found при обновлении несуществующей строки', async () => {
    const { db } = makeFakeDb({ updateResults: [[]] })
    _setDbForTest(db)
    await expect(updateWorkHours(999, { minutes: 60 })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('бросает not_found при удалении несуществующей строки', async () => {
    const { db } = makeFakeDb({ deleteResults: [[]] })
    _setDbForTest(db)
    await expect(deleteWorkHours(999)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('listMasterEntries', () => {
  it('возвращает часы и выплаты раздельно за один вызов', async () => {
    const hoursRow = {
      id: 5,
      masterId: 1,
      workDate: '2026-07-10',
      minutes: 480,
      rateSnapshot: 150,
      note: '',
      createdAt: new Date(),
    }
    const payoutRow = {
      id: 3,
      masterId: 1,
      payoutDate: '2026-07-12',
      amount: -2000,
      note: '',
      createdAt: new Date(),
    }
    const { db } = makeFakeDb({ selectResults: [[hoursRow], [payoutRow]] })
    _setDbForTest(db)

    const entries = await listMasterEntries(1, '2026-07')
    expect(entries.hours).toEqual([hoursRow])
    expect(entries.payouts).toEqual([payoutRow])
  })
})

describe('createPayout — ставка не нужна', () => {
  it('вставляет выплату мастеру без строки ставки (master_rates не читается)', async () => {
    // Заготовлен один select: проверка мастера. Лишний запрос к master_rates
    // забрал бы undefined и упал, так что успех доказывает, что его нет.
    const { db, capture } = makeFakeDb({
      selectResults: [[{ id: 1 }]],
      insertResults: [
        [
          {
            id: 3,
            masterId: 1,
            payoutDate: '2026-07-12',
            amount: -2000,
            note: 'штраф',
            createdAt: new Date(),
          },
        ],
      ],
    })
    _setDbForTest(db)

    const row = await createPayout({
      masterId: 1,
      payoutDate: '2026-07-12',
      amount: -2000,
      note: 'штраф',
    })
    expect(row.amount).toBe(-2000)
    expect(capture.values[0]).toMatchObject({
      masterId: 1,
      payoutDate: '2026-07-12',
      amount: -2000,
    })
  })

  it('бросает master_not_found для неизвестного мастера и ничего не вставляет', async () => {
    const { db, capture } = makeFakeDb({ selectResults: [[]] })
    _setDbForTest(db)

    await expect(
      createPayout({ masterId: 999, payoutDate: '2026-07-12', amount: 500, note: '' }),
    ).rejects.toMatchObject({ constructor: SalaryError, code: 'master_not_found' })
    expect(capture.values).toHaveLength(0)
  })
})

describe('updatePayout / deletePayout', () => {
  it('обновляет только переданные поля', async () => {
    const { db, capture } = makeFakeDb({
      updateResults: [
        [
          {
            id: 3,
            masterId: 1,
            payoutDate: '2026-07-13',
            amount: 700,
            note: 'fix',
            createdAt: new Date(),
          },
        ],
      ],
    })
    _setDbForTest(db)

    await updatePayout(3, { amount: 700, note: 'fix' })
    expect(capture.sets[0]).toEqual({ amount: 700, note: 'fix' })
  })

  it('для пустого patch возвращает текущую строку (без .set({}))', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [
        [
          {
            id: 3,
            masterId: 1,
            payoutDate: '2026-07-12',
            amount: 500,
            note: '',
            createdAt: new Date(),
          },
        ],
      ],
    })
    _setDbForTest(db)

    const row = await updatePayout(3, {})
    expect(row.id).toBe(3)
    expect(capture.sets).toHaveLength(0)
  })

  it('бросает not_found при обновлении несуществующей строки', async () => {
    const { db } = makeFakeDb({ updateResults: [[]] })
    _setDbForTest(db)
    await expect(updatePayout(999, { amount: 100 })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('бросает not_found при удалении несуществующей строки', async () => {
    const { db } = makeFakeDb({ deleteResults: [[]] })
    _setDbForTest(db)
    await expect(deletePayout(999)).rejects.toMatchObject({ code: 'not_found' })
  })
})
