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
import { deleteClient, ClientError } from '../src/db/clients.js'

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
