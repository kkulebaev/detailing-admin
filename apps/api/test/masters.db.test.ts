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

import { _setDbForTest, type Db } from '../src/db/client.js'
import { createMaster, reorderMasters, MasterError } from '../src/db/masters.js'

// Minimal thenable query-builder fake. Terminal methods resolve to a queued
// result; `.set()` / `.values()` payloads are captured for assertions. Results
// are dequeued in call order, so tests seed them to match the code's chains.
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
  it('throws duplicate_name when the name already exists', async () => {
    const { db } = makeFakeDb({ selectResults: [[{ id: 1 }]] })
    _setDbForTest(db)

    await expect(
      createMaster({ name: 'Иван Содель', canBeResponsible: true, telegramId: null }),
    ).rejects.toBeInstanceOf(MasterError)
  })

  it('inserts a new row at position=max+1 when the name is unseen', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [
        [], // no existing row
        [{ max: 4 }], // nextPosition
      ],
      insertResults: [[{ id: 9, name: 'Новый Мастер', position: 5, canBeResponsible: true, telegramId: null }]],
    })
    _setDbForTest(db)

    const row = await createMaster({
      name: 'Новый Мастер',
      canBeResponsible: true,
      telegramId: null,
    })

    expect(row.id).toBe(9)
    expect(capture.values[0]).toMatchObject({ name: 'Новый Мастер', position: 5, canBeResponsible: true, telegramId: null })
  })

  it('persists a supplied telegramId on insert', async () => {
    const { db, capture } = makeFakeDb({
      selectResults: [
        [], // no existing row
        [{ max: 0 }], // nextPosition
      ],
      insertResults: [[{ id: 10, name: 'Пётр', position: 1, canBeResponsible: true, telegramId: '777' }]],
    })
    _setDbForTest(db)

    const row = await createMaster({ name: 'Пётр', canBeResponsible: true, telegramId: '777' })

    expect(row.telegramId).toBe('777')
    expect(capture.values[0]).toMatchObject({ telegramId: '777' })
  })
})

describe('reorderMasters invariant (T3)', () => {
  it('rejects a set that does not match the full id set', async () => {
    const { db } = makeFakeDb({
      selectResults: [[{ id: 1 }, { id: 2 }, { id: 3 }]], // existing ids
    })
    _setDbForTest(db)

    const err = await reorderMasters([1, 2]).catch((e) => e)
    expect(err).toBeInstanceOf(MasterError)
    expect(err.code).toBe('invalid_order')
  })

  it('assigns dense positions 0..n-1 in posted order for a full set', async () => {
    const final = [
      { id: 2, name: 'b', position: 0, canBeResponsible: true, telegramId: null },
      { id: 1, name: 'a', position: 1, canBeResponsible: true, telegramId: null },
    ]
    const { db, capture } = makeFakeDb({
      selectResults: [
        [{ id: 1 }, { id: 2 }], // existing ids
        final, // final ordered list
      ],
      updateResults: [[], []],
    })
    _setDbForTest(db)

    const rows = await reorderMasters([2, 1])
    expect(rows).toEqual(final)
    // Positions assigned densely in posted order.
    expect(capture.sets).toEqual([{ position: 0 }, { position: 1 }])
  })
})
