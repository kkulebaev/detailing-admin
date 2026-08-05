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

// Fake insert chain: insert().values(v).onConflictDoNothing(opts).returning() —
// captures the values/conflict target and resolves to `returningRows` (default a
// fresh id, so the upsert's select-fallback branch is not exercised).
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

// Fake select chain: select({...}).from(t).where(cond) resolves to preset rows.
function makeSelectDb(rows: unknown[]) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(rows) }),
  }))
  return { db: { select } as unknown as Db, select }
}

// Fake insert-then-select db for upsertClientCarReturningId's conflict path: the
// insert returns no row (conflict) and the select-fallback resolves the existing
// id. Captures the where predicate so the normalized lookup key is inspectable.
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

// Fake select-with-limit chain for selectCarId: select().from().where(cond)
// .limit(n) resolves to preset rows; captures the where predicate.
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

describe('upsertClientCarReturningId', () => {
  it('returns the new id when the insert lands a fresh row', async () => {
    const { db, captured } = makeInsertDb([{ id: 'fresh-car-id' }])
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(id).toBe('fresh-car-id')
    // Normalized before insert (make/model collapsed, plate upper + space-stripped).
    expect(captured.values).toMatchObject({
      clientId: CLIENT_ID,
      makeModel: 'Toyota Camry',
      plate: 'А123АА77',
    })
  })

  it('falls back to the existing id on a conflict, matching the same normalized key', async () => {
    const { db, captured } = makeUpsertConflictDb([{ id: 'existing-car-id' }])
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, 'Toyota  Camry', 'а 123 аа 77')

    expect(id).toBe('existing-car-id')
    // The insert wrote the normalized values…
    expect(captured.insertValues).toMatchObject({ makeModel: 'Toyota Camry', plate: 'А123АА77' })
    // …and the select-fallback runs against the same normalized columns (else the
    // id would never be found). Rendered SQL carries the normalized params.
    const rendered = new PgDialect().sqlToQuery(captured.selectWhere as never)
    expect(rendered.params).toContain('Toyota Camry')
    expect(rendered.params).toContain('А123АА77')
    expect(rendered.params).toContain(CLIENT_ID)
  })

  it('returns null on an empty make/model without touching the DB', async () => {
    const { db, insert } = makeInsertDb()
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, '   ', 'А123АА77')

    expect(id).toBeNull()
    expect(insert).not.toHaveBeenCalled()
  })

  it('returns null when the conflict select finds nothing', async () => {
    const { db } = makeUpsertConflictDb([])
    _setDbForTest(db)

    const id = await upsertClientCarReturningId(CLIENT_ID, 'Toyota Camry', '')
    expect(id).toBeNull()
  })
})

describe('selectCarId', () => {
  it('returns the id of a car already in client_cars (read-only, normalized key)', async () => {
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

  it('returns null when no car matches', async () => {
    const { db } = makeSelectLimitDb([])
    _setDbForTest(db)

    expect(await selectCarId(CLIENT_ID, 'Kia Rio', '')).toBeNull()
  })

  it('returns null on an empty make/model without querying (never inserts)', async () => {
    const { db, select } = makeSelectLimitDb([{ id: 'x' }])
    _setDbForTest(db)

    const id = await selectCarId(CLIENT_ID, '  ', 'А123АА77')
    expect(id).toBeNull()
    expect(select).not.toHaveBeenCalled()
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

// Fake tx for syncClientCars: select() → existing rows; delete().where() and
// insert().values().onConflictDoNothing() capture their inputs. transaction()
// invokes the callback with this same fake (single connection is enough).
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
  it('inserts the missing normalized pairs when the client has none', async () => {
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

  it('dedupes pairs that normalize to the same key', async () => {
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

  it('skips empty make/model entries', async () => {
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

  it('deletes rows no longer desired and keeps survivors (no re-insert)', async () => {
    // Keep Toyota, drop BMW, add Kia.
    const { db, captured } = makeSyncDb([
      { id: 'row-toyota', makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { id: 'row-bmw', makeModel: 'BMW X5', plate: '' },
    ])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [
      { makeModel: 'Toyota Camry', plate: 'А123АА77' },
      { makeModel: 'Kia Rio', plate: '' },
    ])

    // Toyota survives → not re-inserted; only Kia is inserted.
    expect(captured.insertValues).toEqual([
      { clientId: CLIENT_ID, makeModel: 'Kia Rio', plate: '' },
    ])
    expect(captured.deleteWhere).toBeDefined()
  })

  it('is idempotent: re-sync of the current set inserts and deletes nothing', async () => {
    const { db, captured } = makeSyncDb([
      { id: 'row-toyota', makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [{ makeModel: 'Toyota Camry', plate: 'А123АА77' }])

    expect(captured.insertValues).toBeNull()
    expect(captured.deleteWhere).toBeUndefined()
  })

  it('clears all rows when given an empty list', async () => {
    const { db, captured } = makeSyncDb([
      { id: 'row-toyota', makeModel: 'Toyota Camry', plate: 'А123АА77' },
    ])
    _setDbForTest(db)

    await syncClientCars(CLIENT_ID, [])

    expect(captured.insertValues).toBeNull()
    expect(captured.deleteWhere).toBeDefined()
  })
})
