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

// Isolate the client-row logic: syncClientCars/listCarsByClient are exercised
// in client-cars.db.test.ts. Here we only assert createClient/updateClient wire
// the cars through and echo the reconciled set the car layer reports.
vi.mock('../src/db/client-cars.js', () => ({
  syncClientCars: vi.fn().mockResolvedValue(undefined),
  listCarsByClient: vi.fn().mockResolvedValue([]),
}))

import { _setDbForTest, type Db } from '../src/db/client.js'
import {
  deleteClient,
  createClient,
  updateClient,
  getClientStats,
  ClientError,
} from '../src/db/clients.js'
import { syncClientCars, listCarsByClient } from '../src/db/client-cars.js'

// Minimal thenable query-builder fake. `deleteClient` runs a `select` (the
// booking-reference probe) followed by a `delete`; both queues are dequeued in
// call order to match the code's chain.
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
  it('throws has_bookings when a booking still references the client', async () => {
    // Probe finds a linked booking → refuse before attempting the delete.
    _setDbForTest(makeFakeDb({ selectResults: [[{ id: 'booking-1' }]], deleteResults: [] }))

    await expect(deleteClient(CLIENT_ID)).rejects.toMatchObject({
      constructor: ClientError,
      code: 'has_bookings',
    })
  })

  it('throws not_found when the client does not exist', async () => {
    _setDbForTest(makeFakeDb({ selectResults: [[]], deleteResults: [[]] }))

    await expect(deleteClient(CLIENT_ID)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('resolves when the client has no bookings and is deleted', async () => {
    _setDbForTest(makeFakeDb({ selectResults: [[]], deleteResults: [[{ id: CLIENT_ID }]] }))

    await expect(deleteClient(CLIENT_ID)).resolves.toBeUndefined()
  })
})

// Chain fake covering select/insert/update; each verb dequeues its own result
// queue in call order.
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
  it('throws duplicate_phone when the phone already exists', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[{ id: 'other' }]] }))

    await expect(createClient('+79001234567', 'Иван', [])).rejects.toMatchObject({
      constructor: ClientError,
      code: 'duplicate_phone',
    })
  })

  it('inserts the client, syncs cars, and returns the reconciled set', async () => {
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
  it('maps a client with no «Выдана» rows to zero/nulls', async () => {
    // The «Выдана» predicate yields no rows → the aggregate is 0/0/null/null.
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

  it('coerces postgres string aggregates to numbers, dates pass through', async () => {
    _setDbForTest(
      makeFakeDb({
        selectResults: [
          [{ totalSpent: '15000', visitCount: '3', lastVisit: '2026-06-10', firstVisit: '2026-01-05' }],
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
  it('throws duplicate_phone when another client owns the phone', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[{ id: 'other' }]] }))

    await expect(updateClient(CLIENT_ID, '+79001234567', 'Иван', [])).rejects.toMatchObject({
      code: 'duplicate_phone',
    })
  })

  it('throws not_found when the row does not exist', async () => {
    _setDbForTest(makeMutationDb({ selectResults: [[]], updateResults: [[]] }))

    await expect(updateClient(CLIENT_ID, '+79001234567', 'Иван', [])).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('updates the client, replaces cars, and returns the reconciled set', async () => {
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
