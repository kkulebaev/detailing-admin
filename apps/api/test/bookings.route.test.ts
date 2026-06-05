import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
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
  init: vi.fn(),
}))

vi.mock('../src/sheets.js', () => ({
  appendBooking: vi.fn(),
  verifyHeaders: vi.fn(),
  _setClientForTest: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { _clearForTest, set as setIdempotency } from '../src/idempotency.js'
import { appendBooking } from '../src/sheets.js'
import {
  getBootState,
  getBootHeadersMismatch,
  getBootNotConfiguredMessage,
} from '../src/boot.js'
import { baseLogger } from '../src/log.js'

const VALID_PAYLOAD = { dateFrom: '04.06.2026', time: '10:00' }

const APPEND_SUCCESS = {
  ok: true as const,
  updatedRange: 'Запись 2026!A5',
  updatedRow: 5,
  latencyMs: 12,
  statusCode: 200,
}

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
): Response | Promise<Response> {
  return app.request('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/bookings', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    _clearForTest()
    vi.mocked(getBootState).mockReturnValue('ok')
    vi.mocked(getBootHeadersMismatch).mockReturnValue(null)
    vi.mocked(appendBooking).mockResolvedValue(APPEND_SUCCESS)
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
