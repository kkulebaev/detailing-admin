import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long',
    AUTH_COOKIE_SECURE: false,
    AUTH_COOKIE_SAMESITE: 'lax',
    AUTH_TOKEN_TTL_SECONDS: 86400,
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  },
}))

vi.mock('../src/log.js', () => ({
  baseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

vi.mock('../src/boot.js', () => ({
  getBootState: vi.fn().mockReturnValue('ok'),
  getBootHeadersMismatch: vi.fn().mockReturnValue(null),
  getBootNotConfiguredMessage: vi.fn().mockReturnValue(null),
  isDbReady: vi.fn().mockReturnValue(true),
  init: vi.fn(),
  initDb: vi.fn(),
}))

vi.mock('../src/sheets.js', () => ({
  appendBooking: vi.fn(),
  verifyHeaders: vi.fn(),
  _setClientForTest: vi.fn(),
}))

vi.mock('../src/db/clients.js', () => ({
  upsertClient: vi.fn(),
}))

vi.mock('../src/db/bookings.js', () => ({
  insertBooking: vi.fn(),
  listBookings: vi.fn(),
  updateBooking: vi.fn(),
  deleteBooking: vi.fn(),
}))

vi.mock('../src/notify.js', () => ({
  notifyMaster: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { _clearForTest, set as setIdempotency } from '../src/idempotency.js'
import { appendBooking } from '../src/sheets.js'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
  isDbReady,
} from '../src/boot.js'
import { upsertClient } from '../src/db/clients.js'
import { insertBooking, listBookings, updateBooking, deleteBooking } from '../src/db/bookings.js'
import { notifyMaster } from '../src/notify.js'
import { baseLogger } from '../src/log.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const VALID_PAYLOAD = {
  dateFrom: '04.06.2026',
  time: '10:00',
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  amount: 5000,
  master: 'Иван Содель',
  responsible: 'Иван Содель',
  carClass: 3,
}

const APPEND_SUCCESS = {
  ok: true as const,
  updatedRange: 'Запись 2026!A5',
  updatedRow: 5,
  latencyMs: 12,
  statusCode: 200,
}

// Set in beforeEach — every protected request rides a valid admin session cookie.
let authCookie = ''

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
): Response | Promise<Response> {
  return app.request('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie, ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/bookings', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    app = createApp()
    _clearForTest()
    authCookie = await adminCookie()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
    vi.mocked(appendBooking).mockResolvedValue(APPEND_SUCCESS)
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(upsertClient).mockResolvedValue({ outcome: 'inserted', client: null })
    vi.mocked(insertBooking).mockResolvedValue(true)
    vi.mocked(notifyMaster).mockResolvedValue({ attempted: true, delivered: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 201 with ok:true and X-Request-Id on valid payload', async () => {
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-1' })
    expect(res.status).toBe(201)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.idempotent).toBe(false)
    expect(typeof body.updatedRange).toBe('string')
    expect(typeof body.updatedRow).toBe('number')
    expect(body.updatedRow).toBeGreaterThanOrEqual(2)
  })

  it('calls Sheets exactly once for first request', async () => {
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-once' })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
  })

  it('same Idempotency-Key within TTL returns idempotent:true with only one Sheets call', async () => {
    const key = 'idem-key'
    const r1 = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    const r2 = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })

    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const b1 = await r1.json()
    const b2 = await r2.json()
    expect(b1.idempotent).toBe(false)
    expect(b2.idempotent).toBe(true)
    expect(b2.updatedRange).toBe(b1.updatedRange)
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
  })

  it('different Idempotency-Keys produce two Sheets calls', async () => {
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-a' })
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'key-b' })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(2)
  })

  it('after TTL expiry same key re-hits Sheets', async () => {
    vi.useFakeTimers()
    const key = 'ttl-key'

    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(2)
  })

  it('missing Idempotency-Key returns 400 validation error', async () => {
    const res = await post(app, VALID_PAYLOAD)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('validation')
    expect(
      (body.issues as Array<{ path: unknown[] }>).some((i) => i.path.includes('Idempotency-Key')),
    ).toBe(true)
  })

  it('invalid time field returns 400 with issue at path ["time"]', async () => {
    const res = await post(
      app,
      { dateFrom: '04.06.2026', time: '25:99' },
      { 'Idempotency-Key': 'k' },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    const issue = (body.issues as Array<{ path: unknown[] }>).find((i) =>
      i.path.includes('time'),
    )
    expect(issue).toBeTruthy()
  })

  it('missing dateFrom returns 400 validation error', async () => {
    const res = await post(app, { time: '10:00' }, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
  })

  it('bootState === headers_mismatch returns 503 unavailable with no Sheets call', async () => {
    vi.mocked(getBootState).mockReturnValue('headers_mismatch')
    vi.mocked(getBootHeadersMismatch).mockReturnValue({
      column_index: 8,
      expected: 'Готовность',
      observed: 'Готовнсть',
    })

    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('headers_mismatch')
    expect(body.column_index).toBe(8)
    expect(body.expected).toBe('Готовность')
    expect(body.observed).toBe('Готовнсть')
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })

  it('boot-blocked 503 path emits no per-request log (plan §7)', async () => {
    vi.mocked(getBootState).mockReturnValue('headers_mismatch')
    vi.mocked(getBootHeadersMismatch).mockReturnValue({
      column_index: 8,
      expected: 'Готовность',
      observed: 'Готовнсть',
    })
    vi.mocked(baseLogger.info).mockClear()
    vi.mocked(baseLogger.warn).mockClear()
    vi.mocked(baseLogger.error).mockClear()

    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(503)
    expect(vi.mocked(baseLogger.info)).not.toHaveBeenCalled()
    expect(vi.mocked(baseLogger.warn)).not.toHaveBeenCalled()
    expect(vi.mocked(baseLogger.error)).not.toHaveBeenCalled()
  })

  it('bootState === not_configured returns 503 with reason:not_configured and message', async () => {
    vi.mocked(getBootState).mockReturnValue('not_configured')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
    vi.mocked(getBootNotConfiguredMessage).mockReturnValue('Invalid base64 credentials')

    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k' })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('not_configured')
    expect(body.message).toBe('Invalid base64 credentials')
    expect(body.column_index).toBeUndefined()
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })

  it('Idempotency-Key longer than 128 chars returns 400 validation error', async () => {
    const longKey = 'k'.repeat(200)
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': longKey })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('validation')
    expect(
      (body.issues as Array<{ path: unknown[]; message: string }>).some((i) =>
        i.path.includes('Idempotency-Key') && /128/.test(i.message),
      ),
    ).toBe(true)
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })

  it('cache hit with a leaked non-ok entry is evicted, not returned', async () => {
    const key = 'leaked-error-key'
    setIdempotency(key, {
      ok: false,
      error: 'internal',
    })
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': key })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // The leaked entry was evicted, so Sheets was called fresh.
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
  })

  it('Sheets failure returns 502 with error:sheets', async () => {
    vi.mocked(appendBooking).mockResolvedValue({
      ok: false,
      latencyMs: 5,
      statusCode: 503,
      errorCode: 'rateLimitExceeded',
      message: 'Rate limit exceeded',
    })
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-fail' })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('sheets')
  })

  it('upserts client with normalized phone and name after successful Sheets append', async () => {
    await post(
      app,
      { ...VALID_PAYLOAD, phone: '8 (900) 123-45-67', name: 'Иван' },
      { 'Idempotency-Key': 'k-client' },
    )
    expect(vi.mocked(upsertClient)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsertClient)).toHaveBeenCalledWith('+79001234567', 'Иван')
  })

  it('does not call upsertClient when DB is not ready (best-effort)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await post(
      app,
      { ...VALID_PAYLOAD, phone: '+79001234567', name: 'Иван' },
      { 'Idempotency-Key': 'k-no-db' },
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(upsertClient)).not.toHaveBeenCalled()
  })

  it('does not notify the master when notify is absent', async () => {
    await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-no-notify' })
    expect(vi.mocked(notifyMaster)).not.toHaveBeenCalled()
  })

  it('notifies the master and echoes a delivered result when notify is true', async () => {
    const res = await post(
      app,
      { ...VALID_PAYLOAD, notify: true },
      { 'Idempotency-Key': 'k-notify-ok' },
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(notifyMaster)).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.notification).toEqual({ attempted: true, delivered: true })
  })

  it('booking still succeeds and reports a failed notification (best-effort)', async () => {
    vi.mocked(notifyMaster).mockResolvedValue({
      attempted: true,
      delivered: false,
      reason: 'no_telegram_id',
    })
    const res = await post(
      app,
      { ...VALID_PAYLOAD, notify: true },
      { 'Idempotency-Key': 'k-notify-fail' },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.notification).toEqual({
      attempted: true,
      delivered: false,
      reason: 'no_telegram_id',
    })
  })

  it('idempotent replay returns the cached notification without re-sending', async () => {
    const key = 'k-notify-replay'
    await post(app, { ...VALID_PAYLOAD, notify: true }, { 'Idempotency-Key': key })
    const res = await post(app, { ...VALID_PAYLOAD, notify: true }, { 'Idempotency-Key': key })
    const body = await res.json()
    expect(body.idempotent).toBe(true)
    expect(body.notification).toEqual({ attempted: true, delivered: true })
    // Replay must not re-send — notifyMaster was called only on the first hit.
    expect(vi.mocked(notifyMaster)).toHaveBeenCalledTimes(1)
  })

  it('booking still succeeds when upsertClient throws (best-effort)', async () => {
    vi.mocked(upsertClient).mockRejectedValueOnce(new Error('db connection refused'))
    const res = await post(
      app,
      { ...VALID_PAYLOAD, phone: '+79001234567', name: 'Иван' },
      { 'Idempotency-Key': 'k-db-fail' },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.client_upsert_failed' }),
      expect.any(String),
    )
  })

  it('mirrors the booking into the DB with client link and Sheets coords', async () => {
    vi.mocked(upsertClient).mockResolvedValue({
      outcome: 'inserted',
      client: { id: 'client-uuid-1', phone: '+79001234567', name: 'Иван' },
    })
    await post(
      app,
      { ...VALID_PAYLOAD, phone: '8 (900) 123-45-67', name: 'Иван' },
      { 'Idempotency-Key': 'k-mirror' },
    )
    expect(vi.mocked(insertBooking)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(insertBooking)).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+79001234567', name: 'Иван' }),
      {
        idempotencyKey: 'k-mirror',
        clientId: 'client-uuid-1',
        sheetRow: 5,
        sheetRange: 'Запись 2026!A5',
      },
    )
  })

  it('does not mirror the booking when DB is not ready (best-effort)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-no-mirror' })
    expect(res.status).toBe(201)
    expect(vi.mocked(insertBooking)).not.toHaveBeenCalled()
  })

  it('mirrors the booking with a null client link when upsertClient throws', async () => {
    vi.mocked(upsertClient).mockRejectedValueOnce(new Error('db connection refused'))
    await post(
      app,
      { ...VALID_PAYLOAD, phone: '+79001234567', name: 'Иван' },
      { 'Idempotency-Key': 'k-mirror-null-client' },
    )
    expect(vi.mocked(insertBooking)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ clientId: null, idempotencyKey: 'k-mirror-null-client' }),
    )
  })

  it('booking still succeeds when the mirror insert throws (best-effort)', async () => {
    vi.mocked(insertBooking).mockRejectedValueOnce(new Error('unique violation'))
    const res = await post(app, VALID_PAYLOAD, { 'Idempotency-Key': 'k-mirror-fail' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.db_mirror_failed' }),
      expect.any(String),
    )
  })

  it('rejects a booking write from a non-admin role (writes stay admin-only)', async () => {
    const res = await post(app, VALID_PAYLOAD, {
      'Idempotency-Key': 'k-emp-write',
      Cookie: await employeeCookie(),
    })
    expect(res.status).toBe(403)
    expect(vi.mocked(appendBooking)).not.toHaveBeenCalled()
  })
})

describe('GET /api/bookings', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  const SAMPLE_ROW = {
    id: '11111111-1111-1111-1111-111111111111',
    idempotencyKey: 'key-1',
    clientId: null,
    name: 'Иван',
    phone: '+79991234567',
    car: 'Toyota Camry',
    service: 'Полировка',
    note: '',
    amount: 5000,
    amountFormula: null,
    dateFrom: '2026-06-04',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: '',
    master: 'Иван Содель',
    responsible: 'Иван Содель',
    carClass: 3,
    sheetRow: 5,
    sheetRange: 'Запись 2026!A5',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(listBookings).mockResolvedValue({ items: [SAMPLE_ROW], total: 1 })
  })

  function getList(query = '', headers: Record<string, string> = { Cookie: cookie }) {
    return app.request(`/api/bookings${query}`, { method: 'GET', headers })
  }

  it('returns 200 with items and total for admin, without the idempotency key', async () => {
    const res = await getList()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(SAMPLE_ROW.id)
    expect(body.items[0].createdAt).toBe('2026-06-01T12:00:00.000Z')
    expect(body.items[0].idempotencyKey).toBeUndefined()
    // Admins see the amount.
    expect(body.items[0].amount).toBe(SAMPLE_ROW.amount)
  })

  it('converts DD.MM.YYYY date filters to ISO and forwards paging/search', async () => {
    const qs = new URLSearchParams({
      dateFrom: '04.06.2026',
      dateTo: '05.06.2026',
      master: 'Иван Содель',
      q: 'Toyota',
      limit: '10',
      offset: '20',
    })
    await getList(`?${qs.toString()}`)
    expect(vi.mocked(listBookings)).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
      dateFrom: '2026-06-04',
      dateTo: '2026-06-05',
      master: 'Иван Содель',
      readiness: undefined,
      q: 'Toyota',
    })
  })

  it('returns 503 when DB is not ready, without querying', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await getList()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(vi.mocked(listBookings)).not.toHaveBeenCalled()
  })

  it('returns 401 without an auth cookie', async () => {
    const res = await getList('', {})
    expect(res.status).toBe(401)
  })

  it('lets a non-admin role read the list but strips the amount fields', async () => {
    const res = await getList('', { Cookie: await employeeCookie() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(1)
    // Non-amount fields stay visible…
    expect(body.items[0].name).toBe(SAMPLE_ROW.name)
    // …but amounts are admin-only.
    expect(body.items[0].amount).toBeUndefined()
    expect(body.items[0].amountFormula).toBeUndefined()
  })

  it('returns 400 for a malformed date filter', async () => {
    const res = await getList('?dateFrom=2026-06-04')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
  })
})

describe('PATCH & DELETE /api/bookings/{id}', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''
  const ID = '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e'
  const UPDATED_ROW = {
    id: ID,
    idempotencyKey: 'key-1',
    clientId: null,
    name: 'Иван',
    phone: '+79991234567',
    car: 'Toyota Camry',
    service: 'Полировка',
    note: '',
    amount: 7000,
    amountFormula: null,
    dateFrom: '2026-06-04',
    dateTo: null,
    timeFrom: '10:00',
    timeTo: null,
    readiness: 'Готова к выдаче',
    master: 'Иван Содель',
    responsible: 'Иван Содель',
    carClass: 3,
    sheetRow: 5,
    sheetRange: 'Запись 2026!A5',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
  }

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(upsertClient).mockResolvedValue({ outcome: 'updated', client: null })
    vi.mocked(updateBooking).mockResolvedValue(UPDATED_ROW)
    vi.mocked(deleteBooking).mockResolvedValue(true)
  })

  const patch = (body: unknown, headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/${ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const del = (headers: Record<string, string> = { Cookie: cookie }) =>
    app.request(`/api/bookings/${ID}`, { method: 'DELETE', headers })

  it('PATCH updates a booking for admin → 200 with the updated row (no idempotency key)', async () => {
    const res = await patch(VALID_PAYLOAD)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.booking.id).toBe(ID)
    expect(body.booking.amount).toBe(7000)
    expect(body.booking.idempotencyKey).toBeUndefined()
    expect(vi.mocked(updateBooking)).toHaveBeenCalled()
  })

  it('PATCH a missing booking → 404', async () => {
    vi.mocked(updateBooking).mockResolvedValue(null)
    const res = await patch(VALID_PAYLOAD)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('PATCH with an invalid body → 400', async () => {
    const res = await patch({ ...VALID_PAYLOAD, time: '99:99' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('validation')
  })

  it('PATCH from a non-admin role → 403 (writes stay admin-only)', async () => {
    const res = await patch(VALID_PAYLOAD, { Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(updateBooking)).not.toHaveBeenCalled()
  })

  it('PATCH returns 503 when DB is not ready', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await patch(VALID_PAYLOAD)).status).toBe(503)
  })

  it('DELETE removes a booking for admin → 200', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(vi.mocked(deleteBooking)).toHaveBeenCalledWith(ID)
  })

  it('DELETE a missing booking → 404', async () => {
    vi.mocked(deleteBooking).mockResolvedValue(false)
    expect((await del()).status).toBe(404)
  })

  it('DELETE from a non-admin role → 403', async () => {
    const res = await del({ Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(deleteBooking)).not.toHaveBeenCalled()
  })

  it('DELETE returns 503 when DB is not ready', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await del()).status).toBe(503)
  })
})

describe('GET /healthz', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
  })

  it('returns 200 ok:true when boot is ok', async () => {
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.time).toBe('string')
  })

  it('returns 503 unavailable when bootState is headers_mismatch', async () => {
    vi.mocked(getBootState).mockReturnValue('headers_mismatch')
    vi.mocked(getBootHeadersMismatch).mockReturnValue({
      column_index: 8,
      expected: 'Готовность',
      observed: 'Готовнсть',
    })
    const res = await app.request('/healthz')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('headers_mismatch')
    expect(body.column_index).toBe(8)
  })
})

describe('404 fallback', () => {
  it('returns 404 for unknown routes', async () => {
    const app = createApp()
    const res = await app.request('/unknown-path')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('not_found')
  })
})
