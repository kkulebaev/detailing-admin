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

// Настоящий ScheduleRequestError, чтобы в роутах работал `err instanceof`.
vi.mock('../src/db/schedule-requests.js', () => {
  class ScheduleRequestError extends Error {
    constructor(
      public readonly code: string,
      public readonly dates: string[] = [],
    ) {
      super(code)
      this.name = 'ScheduleRequestError'
    }
  }
  return {
    ScheduleRequestError,
    listMyScheduleRequests: vi.fn(),
    listPendingScheduleRequests: vi.fn(),
    createScheduleRequest: vi.fn(),
    withdrawScheduleRequest: vi.fn(),
    decideScheduleRequest: vi.fn(),
  }
})

vi.mock('../src/db/masters.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/db/masters.js')>()),
  findMasterByUserId: vi.fn(),
}))

vi.mock('../src/shop-date.js', () => ({ shopToday: () => '2026-11-20' }))

import { createApp } from '../src/server.js'
import { findMasterByUserId } from '../src/db/masters.js'
import type { Master } from '../src/db/schema.js'
import {
  ScheduleRequestError,
  createScheduleRequest,
  decideScheduleRequest,
  listMyScheduleRequests,
  listPendingScheduleRequests,
  withdrawScheduleRequest,
} from '../src/db/schedule-requests.js'
import { adminCookie, bookerCookie, employeeCookie } from './auth-helpers.js'

function req(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  opts: { body?: unknown; cookie: string },
): Response | Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: opts.cookie },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

const master = { id: 7, name: 'Иван', archived: false } as Master
const request = {
  id: 3,
  masterId: 7,
  masterName: 'Иван',
  status: 'pending' as const,
  days: [{ date: '2026-11-25', working: true }],
  comment: null,
  createdAt: '2026-11-20T08:00:00.000Z',
  decidedAt: null,
  decidedByName: null,
}
const body = { days: [{ date: '2026-11-25', working: true }] }

describe('/api/me/schedule-requests', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(findMasterByUserId).mockReset().mockResolvedValue(master)
    vi.mocked(createScheduleRequest).mockReset()
    vi.mocked(withdrawScheduleRequest).mockReset()
    vi.mocked(listMyScheduleRequests).mockReset()
  })

  it('GET без привязки к мастеру отдает пустой список и день студии', async () => {
    vi.mocked(findMasterByUserId).mockResolvedValue(undefined)
    const res = await req(app, 'GET', '/api/me/schedule-requests', {
      cookie: await employeeCookie(),
    })
    expect(await res.json()).toEqual({
      ok: true,
      masterId: null,
      today: '2026-11-20',
      requests: [],
    })
  })

  it('GET отдает заявки своего мастера', async () => {
    vi.mocked(listMyScheduleRequests).mockResolvedValue([request])
    const res = await req(app, 'GET', '/api/me/schedule-requests', {
      cookie: await employeeCookie(),
    })
    expect(await res.json()).toMatchObject({ ok: true, masterId: 7, requests: [request] })
    expect(vi.mocked(listMyScheduleRequests)).toHaveBeenCalledWith(7)
  })

  it('POST отправляет заявку за своего мастера', async () => {
    vi.mocked(createScheduleRequest).mockResolvedValue(request)
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body,
      cookie: await bookerCookie(),
    })
    expect(res.status).toBe(201)
    expect(vi.mocked(createScheduleRequest)).toHaveBeenCalledWith(7, body.days, 'u-booker')
  })

  it('POST принимает прошедшие дни', async () => {
    vi.mocked(createScheduleRequest).mockResolvedValue(request)
    const days = [{ date: '2026-10-05', working: false }]
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body: { days },
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(201)
    expect(vi.mocked(createScheduleRequest)).toHaveBeenCalledWith(7, days, 'u-emp')
  })

  it('POST дальше горизонта → 400 too_far', async () => {
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body: { days: [{ date: '2028-01-01', working: true }] },
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'too_far' })
    expect(vi.mocked(createScheduleRequest)).not.toHaveBeenCalled()
  })

  it('POST с повторяющимися днями → 400', async () => {
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body: { days: [body.days[0], { date: '2026-11-25', working: false }] },
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(400)
    expect(vi.mocked(createScheduleRequest)).not.toHaveBeenCalled()
  })

  it('POST без привязки к мастеру → 400 not_linked', async () => {
    vi.mocked(findMasterByUserId).mockResolvedValue(undefined)
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body,
      cookie: await employeeCookie(),
    })
    expect(await res.json()).toMatchObject({ reason: 'not_linked' })
  })

  it('POST с рабочим днем в выходной студии → 400 studio_closed', async () => {
    vi.mocked(createScheduleRequest).mockRejectedValue(
      new ScheduleRequestError('studio_closed', ['2026-11-29']),
    )
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body,
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'validation',
      reason: 'studio_closed',
      dates: ['2026-11-29'],
    })
  })

  it('POST при заявке на согласовании → 409 pending_exists', async () => {
    vi.mocked(createScheduleRequest).mockRejectedValue(new ScheduleRequestError('pending_exists'))
    const res = await req(app, 'POST', '/api/me/schedule-requests', {
      body,
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'pending_exists' })
  })

  it('DELETE отзывает только свою заявку', async () => {
    vi.mocked(withdrawScheduleRequest).mockResolvedValue()
    const res = await req(app, 'DELETE', '/api/me/schedule-requests/3', {
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(withdrawScheduleRequest)).toHaveBeenCalledWith(7, 3)
  })

  it('DELETE уже рассмотренной заявки → 409', async () => {
    vi.mocked(withdrawScheduleRequest).mockRejectedValue(
      new ScheduleRequestError('already_decided'),
    )
    const res = await req(app, 'DELETE', '/api/me/schedule-requests/3', {
      cookie: await employeeCookie(),
    })
    expect(res.status).toBe(409)
  })
})

describe('/api/schedule-requests', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(listPendingScheduleRequests).mockReset()
    vi.mocked(decideScheduleRequest).mockReset()
  })

  it('доступен только админу', async () => {
    for (const cookie of [await employeeCookie(), await bookerCookie()]) {
      expect((await req(app, 'GET', '/api/schedule-requests', { cookie })).status).toBe(403)
      const approve = await req(app, 'POST', '/api/schedule-requests/3/approve', { cookie })
      expect(approve.status).toBe(403)
    }
    expect(vi.mocked(decideScheduleRequest)).not.toHaveBeenCalled()
  })

  it('GET отдает заявки на согласовании', async () => {
    vi.mocked(listPendingScheduleRequests).mockResolvedValue([request])
    const res = await req(app, 'GET', '/api/schedule-requests', { cookie: await adminCookie() })
    expect(await res.json()).toEqual({ ok: true, requests: [request] })
  })

  it('approve записывает решение от имени админа', async () => {
    vi.mocked(decideScheduleRequest).mockResolvedValue()
    const res = await req(app, 'POST', '/api/schedule-requests/3/approve', {
      cookie: await adminCookie({ firstName: 'Анна' }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(decideScheduleRequest)).toHaveBeenCalledWith(
      3,
      { id: 'u-admin', login: 'admin', name: 'Анна' },
      { approve: true },
    )
  })

  it('reject без комментария сохраняет null', async () => {
    vi.mocked(decideScheduleRequest).mockResolvedValue()
    const res = await req(app, 'POST', '/api/schedule-requests/3/reject', {
      body: { comment: '  ' },
      cookie: await adminCookie(),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(decideScheduleRequest)).toHaveBeenCalledWith(3, expect.anything(), {
      approve: false,
      comment: null,
    })
  })

  it('approve заявки с рабочим днем в выходной студии → 400 studio_closed', async () => {
    vi.mocked(decideScheduleRequest).mockRejectedValue(
      new ScheduleRequestError('studio_closed', ['2026-11-29']),
    )
    const res = await req(app, 'POST', '/api/schedule-requests/3/approve', {
      cookie: await adminCookie(),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'studio_closed', dates: ['2026-11-29'] })
  })

  it('решение по уже рассмотренной заявке → 409, по несуществующей → 404', async () => {
    const cookie = await adminCookie()
    vi.mocked(decideScheduleRequest).mockRejectedValueOnce(
      new ScheduleRequestError('already_decided'),
    )
    const approve = await req(app, 'POST', '/api/schedule-requests/3/approve', { cookie })
    expect(approve.status).toBe(409)
    vi.mocked(decideScheduleRequest).mockRejectedValueOnce(new ScheduleRequestError('not_found'))
    const reject = await req(app, 'POST', '/api/schedule-requests/3/reject', { body: {}, cookie })
    expect(reject.status).toBe(404)
  })
})
