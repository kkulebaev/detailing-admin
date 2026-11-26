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
  return { ScheduleError, listSchedule: vi.fn(), setScheduleDays: vi.fn() }
})

vi.mock('../src/db/studio-hours.js', () => ({ getStudioHours: vi.fn(), setStudioHours: vi.fn() }))

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { ScheduleError, listSchedule, setScheduleDays } from '../src/db/schedule.js'
import { getStudioHours, setStudioHours } from '../src/db/studio-hours.js'
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
const body = { days: [day] }

describe('/api/schedule', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(listSchedule).mockReset()
    vi.mocked(setScheduleDays).mockReset()
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
    const res = await req(app, 'PATCH', { body, cookie: '' })
    expect(res.status).toBe(401)
    expect(vi.mocked(setScheduleDays)).not.toHaveBeenCalled()
  })

  it('PATCH доступен только админу', async () => {
    for (const cookie of [await employeeCookie(), await bookerCookie()]) {
      const res = await req(app, 'PATCH', { body, cookie })
      expect(res.status).toBe(403)
    }
    expect(vi.mocked(setScheduleDays)).not.toHaveBeenCalled()
  })

  it('PATCH от админа сохраняет дни пачкой', async () => {
    vi.mocked(setScheduleDays).mockResolvedValue()
    const res = await req(app, 'PATCH', { body, cookie: await adminCookie() })
    expect(res.status).toBe(200)
    expect(vi.mocked(setScheduleDays)).toHaveBeenCalledWith([day])
  })

  it('PATCH для архивного или несуществующего мастера → 404', async () => {
    vi.mocked(setScheduleDays).mockRejectedValue(new ScheduleError('not_found'))
    const res = await req(app, 'PATCH', { body, cookie: await adminCookie() })
    expect(res.status).toBe(404)
  })

  it('PATCH с несуществующей датой → 400', async () => {
    const res = await req(app, 'PATCH', {
      body: { days: [{ ...day, date: '2026-02-30' }] },
      cookie: await adminCookie(),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH с пустым списком дней → 400', async () => {
    const res = await req(app, 'PATCH', { body: { days: [] }, cookie: await adminCookie() })
    expect(res.status).toBe(400)
    expect(vi.mocked(setScheduleDays)).not.toHaveBeenCalled()
  })
})

describe('/api/schedule/studio-hours', () => {
  let app: ReturnType<typeof createApp>

  function studio(method: string, opts: { body?: unknown; cookie: string }) {
    return app.request('/api/schedule/studio-hours', {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: opts.cookie },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  }

  const monday = { weekday: 0, opensAt: '09:00', closesAt: '21:00' }
  const saturday = { weekday: 5, opensAt: '10:00', closesAt: '24:00' }

  beforeEach(() => {
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(getStudioHours).mockReset()
    vi.mocked(setStudioHours).mockReset()
  })

  it('GET без сессии → 401', async () => {
    expect((await studio('GET', { cookie: '' })).status).toBe(401)
  })

  it('GET открыт сотруднику', async () => {
    vi.mocked(getStudioHours).mockResolvedValue([monday])
    const res = await studio('GET', { cookie: await employeeCookie() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, days: [monday] })
  })

  it('GET при недоступной БД → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await studio('GET', { cookie: await adminCookie() })).status).toBe(503)
  })

  it('PUT доступен только админу', async () => {
    for (const cookie of [await employeeCookie(), await bookerCookie()]) {
      const res = await studio('PUT', { body: { days: [monday] }, cookie })
      expect(res.status).toBe(403)
    }
    expect(vi.mocked(setStudioHours)).not.toHaveBeenCalled()
  })

  it('PUT от админа заменяет режим и отдает дни по порядку недели', async () => {
    vi.mocked(setStudioHours).mockResolvedValue()
    const res = await studio('PUT', {
      body: { days: [saturday, monday] },
      cookie: await adminCookie(),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, days: [monday, saturday] })
    expect(vi.mocked(setStudioHours)).toHaveBeenCalledWith([saturday, monday])
  })

  it.each([
    ['пустой список', { days: [] }],
    ['закрытие раньше открытия', { days: [{ weekday: 0, opensAt: '21:00', closesAt: '09:00' }] }],
    ['кривое время', { days: [{ weekday: 0, opensAt: '9:00', closesAt: '25:00' }] }],
    ['день недели вне 0–6', { days: [{ ...monday, weekday: 7 }] }],
    ['день недели дважды', { days: [monday, { ...monday, opensAt: '10:00' }] }],
  ])('PUT: %s → 400', async (_name, body) => {
    const res = await studio('PUT', { body, cookie: await adminCookie() })
    expect(res.status).toBe(400)
    expect(vi.mocked(setStudioHours)).not.toHaveBeenCalled()
  })
})
