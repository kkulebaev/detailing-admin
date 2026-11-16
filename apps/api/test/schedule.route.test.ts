import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-sheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{}').toString('base64'),
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

// Настоящий ScheduleError, чтобы в роуте работал `err instanceof ScheduleError`.
vi.mock('../src/db/schedule.js', () => {
  class ScheduleError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'ScheduleError'
    }
  }
  return { ScheduleError, listSchedule: vi.fn(), setScheduleDay: vi.fn() }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { ScheduleError, listSchedule, setScheduleDay } from '../src/db/schedule.js'
import { adminCookie, bookerCookie, employeeCookie } from './auth-helpers.js'

function req(
  app: ReturnType<typeof createApp>,
  method: string,
  opts: { query?: string; body?: unknown; cookie: string },
): Response | Promise<Response> {
  return app.request(`/api/schedule${opts.query ?? ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: opts.cookie },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

const day = { masterId: 1, date: '2026-11-16', working: true }

describe('/api/schedule', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(listSchedule).mockReset()
    vi.mocked(setScheduleDay).mockReset()
  })

  it('GET без сессии → 401', async () => {
    const res = await req(app, 'GET', { query: '?from=2026-11-01&to=2026-11-30', cookie: '' })
    expect(res.status).toBe(401)
  })

  it('GET открыт сотруднику и отдает график', async () => {
    vi.mocked(listSchedule).mockResolvedValue([{ masterId: 1, dates: ['2026-11-16'] }])
    const res = await req(app, 'GET', {
      query: '?from=2026-11-01&to=2026-11-30',
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      from: '2026-11-01',
      to: '2026-11-30',
      schedule: [{ masterId: 1, dates: ['2026-11-16'] }],
    })
    expect(vi.mocked(listSchedule)).toHaveBeenCalledWith('2026-11-01', '2026-11-30')
  })

  it('GET с перевернутым или слишком длинным периодом → 400', async () => {
    const cookie = await adminCookie()
    const reversed = await req(app, 'GET', { query: '?from=2026-11-30&to=2026-11-01', cookie })
    expect(reversed.status).toBe(400)
    const tooLong = await req(app, 'GET', { query: '?from=2026-01-01&to=2026-12-31', cookie })
    expect(tooLong.status).toBe(400)
    expect(vi.mocked(listSchedule)).not.toHaveBeenCalled()
  })

  it('GET при недоступной БД → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req(app, 'GET', {
      query: '?from=2026-11-01&to=2026-11-30',
      cookie: await adminCookie(),
    })
    expect(res.status).toBe(503)
  })

  it('PATCH без сессии → 401', async () => {
    const res = await req(app, 'PATCH', { body: day, cookie: '' })
    expect(res.status).toBe(401)
    expect(vi.mocked(setScheduleDay)).not.toHaveBeenCalled()
  })

  it('PATCH доступен только админу', async () => {
    for (const cookie of [await employeeCookie(), await bookerCookie()]) {
      const res = await req(app, 'PATCH', { body: day, cookie })
      expect(res.status).toBe(403)
    }
    expect(vi.mocked(setScheduleDay)).not.toHaveBeenCalled()
  })

  it('PATCH от админа отмечает день', async () => {
    vi.mocked(setScheduleDay).mockResolvedValue()
    const res = await req(app, 'PATCH', { body: day, cookie: await adminCookie() })
    expect(res.status).toBe(200)
    expect(vi.mocked(setScheduleDay)).toHaveBeenCalledWith(1, '2026-11-16', true)
  })

  it('PATCH для архивного или несуществующего мастера → 404', async () => {
    vi.mocked(setScheduleDay).mockRejectedValue(new ScheduleError('not_found'))
    const res = await req(app, 'PATCH', { body: day, cookie: await adminCookie() })
    expect(res.status).toBe(404)
  })

  it('PATCH с несуществующей датой → 400', async () => {
    const res = await req(app, 'PATCH', {
      body: { ...day, date: '2026-02-30' },
      cookie: await adminCookie(),
    })
    expect(res.status).toBe(400)
  })
})
