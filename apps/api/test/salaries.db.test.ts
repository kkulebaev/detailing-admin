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
  createWorkHours,
  deleteWorkHours,
  listSalaries,
  setMasterRate,
  updateWorkHours,
} from '../src/db/salaries.js'

// Thenable query-builder fake. Terminal awaits dequeue from `selectResults` in
// call order; `.set()`/`.values()` payloads are captured for assertions. The
// subquery/join methods are passthroughs — the aggregate SUMs are exercised by
// seeding the final joined rows the way Postgres would return them (SUM as a
// string), so the JS mapping + single rounding is what's under test here.
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
    // A subquery alias — columns are referenced (agg.masterId, ...) but the
    // passthrough select ignores them, so any dummy suffices.
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

describe('listSalaries — mapping and single rounding', () => {
  it('rounds the month total once (non-integer case): SUM=5000 ₽·min → 83, not 84', () => {
    // Two 25-min rows @100 ₽/ч aggregate in SQL to minutes_rate_sum=5000. If the
    // division were done in SQL as int/int it would truncate to 83 by luck here,
    // but per-row rounding would give 84. The single JS round yields 83.
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 1,
            masterName: 'Иван',
            hourlyRate: 100,
            totalMinutes: '50',
            minutesRateSum: '5000',
          },
        ],
      ],
    })
    _setDbForTest(db)

    return listSalaries('2026-07').then((rows) => {
      expect(rows).toEqual([
        { masterId: 1, masterName: 'Иван', hourlyRate: 100, totalMinutes: 50, salary: 83 },
      ])
    })
  })

  it('sums by rate snapshot when the rate changed mid-month', async () => {
    // 60min@100 + 60min@200 → SQL SUM(minutes*rate_snapshot)=18000 → 300 ₽,
    // independent of the master's CURRENT rate (here 200).
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 1,
            masterName: 'Иван',
            hourlyRate: 200,
            totalMinutes: '120',
            minutesRateSum: '18000',
          },
        ],
      ],
    })
    _setDbForTest(db)

    const rows = await listSalaries('2026-07')
    expect(rows[0]).toMatchObject({ totalMinutes: 120, salary: 300 })
  })

  it('keeps a master with no rate (null) and no hours (null agg) at 0 salary', async () => {
    const { db } = makeFakeDb({
      selectResults: [
        [
          {
            masterId: 2,
            masterName: 'Пётр',
            hourlyRate: null,
            totalMinutes: null,
            minutesRateSum: null,
          },
        ],
      ],
    })
    _setDbForTest(db)

    const rows = await listSalaries('2026-07')
    expect(rows[0]).toEqual({
      masterId: 2,
      masterName: 'Пётр',
      hourlyRate: null,
      totalMinutes: 0,
      salary: 0,
    })
  })
})

describe('setMasterRate', () => {
  it('throws master_not_found when the master does not exist', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] })
    _setDbForTest(db)
    await expect(setMasterRate(999, 500)).rejects.toMatchObject({
      constructor: SalaryError,
      code: 'master_not_found',
    })
  })

  it('upserts the rate for an existing master', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [[{ id: 1 }]],
      insertResults: [[]],
    })
    _setDbForTest(db)
    await setMasterRate(1, 700)
    expect(capture.values[0]).toMatchObject({ masterId: 1, hourlyRate: 700 })
  })
})

describe('createWorkHours — snapshots the current rate', () => {
  it('copies the master current rate into rate_snapshot', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [[{ hourlyRate: 150 }]], // current rate lookup
      insertResults: [
        [{ id: 5, masterId: 1, workDate: '2026-07-10', minutes: 480, rateSnapshot: 150, note: '', createdAt: new Date() }],
      ],
    })
    _setDbForTest(db)

    const row = await createWorkHours({ masterId: 1, workDate: '2026-07-10', minutes: 480, note: '' })
    expect(row.rateSnapshot).toBe(150)
    expect(capture.values[0]).toMatchObject({ masterId: 1, minutes: 480, rateSnapshot: 150 })
  })

  it('throws no_rate when the master has no rate row', async () => {
    const { db } = makeFakeDb({ selectResults: [[]] })
    _setDbForTest(db)
    await expect(
      createWorkHours({ masterId: 1, workDate: '2026-07-10', minutes: 480, note: '' }),
    ).rejects.toMatchObject({ code: 'no_rate' })
  })
})

describe('updateWorkHours / deleteWorkHours', () => {
  it('updates day/minutes/note without touching the rate snapshot', async () => {
    const { db, capture } = makeFakeDb({
      updateResults: [
        [{ id: 5, masterId: 1, workDate: '2026-07-11', minutes: 300, rateSnapshot: 150, note: 'fix', createdAt: new Date() }],
      ],
    })
    _setDbForTest(db)

    await updateWorkHours(5, { workDate: '2026-07-11', minutes: 300, note: 'fix' })
    expect(capture.sets[0]).toEqual({ workDate: '2026-07-11', minutes: 300, note: 'fix' })
    expect(capture.sets[0]).not.toHaveProperty('rateSnapshot')
  })

  it('returns the current row for an empty patch (no .set({}))', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [[{ id: 5, masterId: 1, workDate: '2026-07-11', minutes: 300, rateSnapshot: 150, note: '', createdAt: new Date() }]],
    })
    _setDbForTest(db)

    const row = await updateWorkHours(5, {})
    expect(row.id).toBe(5)
    expect(capture.sets).toHaveLength(0)
  })

  it('throws not_found when updating a missing row', async () => {
    const { db } = makeFakeDb({ updateResults: [[]] })
    _setDbForTest(db)
    await expect(updateWorkHours(999, { minutes: 60 })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('throws not_found when deleting a missing row', async () => {
    const { db } = makeFakeDb({ deleteResults: [[]] })
    _setDbForTest(db)
    await expect(deleteWorkHours(999)).rejects.toMatchObject({ code: 'not_found' })
  })
})
