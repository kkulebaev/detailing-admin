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

// Real SalaryError so the route's `err instanceof SalaryError` mappers work.
vi.mock('../src/db/salaries.js', () => {
  class SalaryError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'SalaryError'
    }
  }
  return {
    SalaryError,
    listSalaries: vi.fn(),
    setMasterRate: vi.fn(),
    listWorkHours: vi.fn(),
    createWorkHours: vi.fn(),
    updateWorkHours: vi.fn(),
    deleteWorkHours: vi.fn(),
  }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import {
  SalaryError,
  listSalaries,
  setMasterRate,
  listWorkHours,
  createWorkHours,
  updateWorkHours,
  deleteWorkHours,
} from '../src/db/salaries.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const workHoursRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 5,
  masterId: 1,
  workDate: '2026-07-10',
  minutes: 480,
  rateSnapshot: 150,
  note: '',
  createdAt: new Date('2026-07-10T08:00:00.000Z'),
  ...over,
})

let authCookie = ''

function req(
  path: string,
  method: string,
  body?: unknown,
  cookie: string = authCookie,
): Response | Promise<Response> {
  return createApp().request(`/api/salaries${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('/api/salaries', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    authCookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('GET without a session cookie → 401', async () => {
    const res = await req('?month=2026-07', 'GET', undefined, '')
    expect(res.status).toBe(401)
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('GET with an employee session → 403 (salaries are admin-only)', async () => {
    const res = await req('?month=2026-07', 'GET', undefined, await employeeCookie())
    expect(res.status).toBe(403)
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('GET returns 503 when the DB is not ready', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req('?month=2026-07', 'GET')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('GET lists salaries for the month → 200', async () => {
    vi.mocked(listSalaries).mockResolvedValue([
      { masterId: 1, masterName: 'Иван', hourlyRate: 150, totalMinutes: 480, salary: 1200 },
    ])
    const res = await req('?month=2026-07', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.month).toBe('2026-07')
    expect(body.rows[0].salary).toBe(1200)
    expect(vi.mocked(listSalaries)).toHaveBeenCalledWith('2026-07')
  })

  it('GET with a malformed month → 400 validation', async () => {
    const res = await req('?month=2026-13', 'GET')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('PATCH /rates sets a rate via the PATCH method → 200', async () => {
    vi.mocked(setMasterRate).mockResolvedValue(undefined)
    const res = await req('/rates', 'PATCH', { masterId: 1, hourlyRate: 500 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(setMasterRate)).toHaveBeenCalledWith(1, 500)
  })

  it('PATCH /rates on a missing master → 404', async () => {
    vi.mocked(setMasterRate).mockRejectedValue(new SalaryError('master_not_found'))
    const res = await req('/rates', 'PATCH', { masterId: 999, hourlyRate: 500 })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('PATCH /rates with a 0 rate → 400 validation', async () => {
    const res = await req('/rates', 'PATCH', { masterId: 1, hourlyRate: 0 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(setMasterRate)).not.toHaveBeenCalled()
  })

  it('GET /hours lists a master month records → 200', async () => {
    vi.mocked(listWorkHours).mockResolvedValue([workHoursRow()])
    const res = await req('/hours?masterId=1&month=2026-07', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.hours[0].createdAt).toBe('2026-07-10T08:00:00.000Z')
    expect(vi.mocked(listWorkHours)).toHaveBeenCalledWith(1, '2026-07')
  })

  it('POST /hours adds a record (hours → minutes) → 201', async () => {
    vi.mocked(createWorkHours).mockResolvedValue(workHoursRow())
    const res = await req('/hours', 'POST', {
      masterId: 1,
      workDate: '2026-07-10',
      hours: 8,
      note: 'смена',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.hours.id).toBe(5)
    // hours 8 → 480 minutes on the way in.
    expect(vi.mocked(createWorkHours)).toHaveBeenCalledWith({
      masterId: 1,
      workDate: '2026-07-10',
      minutes: 480,
      note: 'смена',
    })
  })

  it('POST /hours for a master with no rate → 400 validation no_rate', async () => {
    vi.mocked(createWorkHours).mockRejectedValue(new SalaryError('no_rate'))
    const res = await req('/hours', 'POST', { masterId: 1, workDate: '2026-07-10', hours: 8 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(body.reason).toBe('no_rate')
  })

  it('POST /hours with off-grid hours → 400 validation', async () => {
    const res = await req('/hours', 'POST', { masterId: 1, workDate: '2026-07-10', hours: 7.1 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(createWorkHours)).not.toHaveBeenCalled()
  })

  it('PATCH /hours/{id} edits a record → 200', async () => {
    vi.mocked(updateWorkHours).mockResolvedValue(workHoursRow({ minutes: 300, note: 'fix' }))
    const res = await req('/hours/5', 'PATCH', { hours: 5, note: 'fix' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // hours 5 → 300 minutes; masterId/rate never sent on edit.
    expect(vi.mocked(updateWorkHours)).toHaveBeenCalledWith(5, { minutes: 300, note: 'fix' })
  })

  it('PATCH /hours/{id} on a missing record → 404', async () => {
    vi.mocked(updateWorkHours).mockRejectedValue(new SalaryError('not_found'))
    const res = await req('/hours/999', 'PATCH', { hours: 5 })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('DELETE /hours/{id} removes a record → 200', async () => {
    vi.mocked(deleteWorkHours).mockResolvedValue(undefined)
    const res = await req('/hours/5', 'DELETE')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(deleteWorkHours)).toHaveBeenCalledWith(5)
  })

  it.each([
    ['?month=2026-07', 'GET', undefined],
    ['/rates', 'PATCH', { masterId: 1, hourlyRate: 500 }],
    ['/hours?masterId=1&month=2026-07', 'GET', undefined],
    ['/hours', 'POST', { masterId: 1, workDate: '2026-07-10', hours: 8 }],
    ['/hours/5', 'PATCH', { hours: 5 }],
    ['/hours/5', 'DELETE', undefined],
  ])('%s %s returns 503 when DB is not ready', async (path, method, body) => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req(path, method, body)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('unavailable')
  })
})
