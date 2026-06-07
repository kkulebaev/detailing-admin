import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  // Keep DB off in observability tests so each POST emits exactly one log line.
  isDbReady: vi.fn().mockReturnValue(false),
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

import { createApp } from '../src/server.js'
import { _clearForTest } from '../src/idempotency.js'
import { appendBooking } from '../src/sheets.js'
import { baseLogger } from '../src/log.js'

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

const REQUIRED_LOG_FIELDS = [
  'event',
  'request_id',
  'idempotency_key',
  'idempotent',
  'validation_failed',
  'sheets_latency_ms',
  'sheets_status_code',
  'status',
] as const

describe('observability — POST /api/bookings log output', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    _clearForTest()
    vi.mocked(appendBooking).mockResolvedValue({
      ok: true,
      updatedRange: 'Запись 2026!A5',
      updatedRow: 5,
      latencyMs: 10,
      statusCode: 200,
    })
  })

  it('emits exactly one log line per successful POST', async () => {
    await app.request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'log-test-key' },
      body: JSON.stringify(VALID_PAYLOAD),
    })
    expect(vi.mocked(baseLogger.info)).toHaveBeenCalledTimes(1)
  })

  it('log line contains all required structured fields', async () => {
    await app.request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'log-fields-key' },
      body: JSON.stringify(VALID_PAYLOAD),
    })

    const [logObj] = vi.mocked(baseLogger.info).mock.calls[0] as [Record<string, unknown>]
    for (const field of REQUIRED_LOG_FIELDS) {
      expect(logObj, `expected field "${field}" in log object`).toHaveProperty(field)
    }
    expect(logObj.event).toBe('booking.request')
    expect(typeof logObj.request_id).toBe('string')
    expect(logObj.idempotency_key).toBe('log-fields-key')
    expect(logObj.idempotent).toBe(false)
    expect(logObj.validation_failed).toBe(false)
    expect(typeof logObj.sheets_latency_ms).toBe('number')
    expect(logObj.sheets_status_code).toBe(200)
    expect(logObj.status).toBe(201)
  })

  it('X-Request-Id response header matches request_id in the log', async () => {
    const res = await app.request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'reqid-test' },
      body: JSON.stringify(VALID_PAYLOAD),
    })
    const responseRequestId = res.headers.get('X-Request-Id')
    const [logObj] = vi.mocked(baseLogger.info).mock.calls[0] as [Record<string, unknown>]
    expect(logObj.request_id).toBe(responseRequestId)
  })

  it('log object does NOT contain phone, name, or note fields', async () => {
    await app.request('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'pii-test' },
      body: JSON.stringify({
        dateFrom: '04.06.2026',
        time: '10:00',
        name: 'Иван Петров',
        phone: '+79991234567',
        note: 'Важная заметка',
      }),
    })

    const allCalls = [
      ...vi.mocked(baseLogger.info).mock.calls,
      ...vi.mocked(baseLogger.warn).mock.calls,
      ...vi.mocked(baseLogger.error).mock.calls,
    ]
    for (const call of allCalls) {
      const [logObj] = call as [Record<string, unknown>]
      if (typeof logObj !== 'object' || logObj === null) continue
      expect(logObj).not.toHaveProperty('phone')
      expect(logObj).not.toHaveProperty('name')
      expect(logObj).not.toHaveProperty('note')
    }
  })
})
