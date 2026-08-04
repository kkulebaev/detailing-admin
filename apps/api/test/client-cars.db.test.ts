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
  upsertClientCar,
  listCarsByClientIds,
} from '../src/db/client-cars.js'

const CLIENT_ID = 'f233cc73-2f2b-4e6b-8f9a-c3d81f2df450'

afterEach(() => {
  _setDbForTest(null)
})

// Fake insert chain: insert().values(v).onConflictDoNothing(opts) — captures the
// values/conflict target and resolves like a no-op returning-less insert.
function makeInsertDb() {
  const captured: { values?: Record<string, unknown>; conflict?: unknown } = {}
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      captured.values = v
      return {
        onConflictDoNothing: (opts: unknown) => {
          captured.conflict = opts
          return Promise.resolve([])
        },
      }
    },
  }))
  return { db: { insert } as unknown as Db, insert, captured }
}

// Fake select chain: select({...}).from(t).where(cond) resolves to preset rows.
function makeSelectDb(rows: unknown[]) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(rows) }),
  }))
  return { db: { select } as unknown as Db, select }
}

describe('upsertClientCar', () => {
  it('inserts normalized make/model and plate', async () => {
    const { db, captured } = makeInsertDb()
    _setDbForTest(db)

    await upsertClientCar(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(captured.values).toMatchObject({
      clientId: CLIENT_ID,
      makeModel: 'Toyota Camry',
      plate: 'А123АА77',
    })
  })

  it('is a no-op (no insert) on an empty make/model', async () => {
    const { db, insert } = makeInsertDb()
    _setDbForTest(db)

    await upsertClientCar(CLIENT_ID, '   ', 'А123АА77')

    expect(insert).not.toHaveBeenCalled()
  })

  it('dedupes via onConflictDoNothing on the (clientId, makeModel, plate) uniq', async () => {
    const { db, captured } = makeInsertDb()
    _setDbForTest(db)

    await upsertClientCar(CLIENT_ID, 'Toyota Camry', '')

    // Empty plate is stored as '' (never NULL) so the UNIQUE index dedupes it.
    expect(captured.values).toMatchObject({ plate: '' })
    expect(captured.conflict).toMatchObject({ target: expect.any(Array) })
  })
})

describe('listCarsByClientIds', () => {
  it('groups cars by clientId', async () => {
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

  it('returns an empty map without querying on empty ids', async () => {
    const { db, select } = makeSelectDb([])
    _setDbForTest(db)

    const map = await listCarsByClientIds([])

    expect(map.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })
})
