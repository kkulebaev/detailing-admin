import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

vi.mock('../src/db/salaries.js', () => {
  class SalaryError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'SalaryError'
    }
  }
  return {
    SalaryError,
    getMasterRate: vi.fn(),
    getWorkHoursById: vi.fn(),
    listMasterEntries: vi.fn(),
    createWorkHours: vi.fn(),
    updateWorkHours: vi.fn(),
    deleteWorkHours: vi.fn(),
  }
})

vi.mock('../src/db/masters.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/db/masters.js')>()),
  findMasterByUserId: vi.fn(),
}))

vi.mock('../src/db/users.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/db/users.js')>()),
  listAccounts: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { findMasterByUserId } from '../src/db/masters.js'
import { listAccounts } from '../src/db/users.js'
import {
  SalaryError,
  createWorkHours,
  deleteWorkHours,
  getMasterRate,
  getWorkHoursById,
  listMasterEntries,
  updateWorkHours,
} from '../src/db/salaries.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

// 2026-10-26 по Москве → окно редактирования 2026-10-20 … 2026-10-26.
const NOW = new Date('2026-10-26T09:00:00.000Z')

const MASTER = {
  id: 4,
  name: 'Петр',
  position: 0,
  canBeResponsible: true,
  paidSalary: true,
  archived: false,
  telegramId: null,
  userId: 'u-emp',
}

const hoursRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 11,
  masterId: MASTER.id,
  workDate: '2026-10-24',
  minutes: 480,
  rateSnapshot: 300,
  note: '',
  createdAt: new Date('2026-10-24T18:00:00.000Z'),
  ...over,
})

let cookie = ''

function req(path: string, method: string, body?: unknown, c: string = cookie) {
  return createApp().request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: c },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('/api/me', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    cookie = await employeeCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(findMasterByUserId).mockResolvedValue(MASTER)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('требует сессию', async () => {
    const res = await req('/api/me/salary?month=2026-10', 'GET', undefined, '')
    expect(res.status).toBe(401)
  })

  it('GET /salary определяет мастера по сессии, а не по запросу', async () => {
    vi.mocked(getMasterRate).mockResolvedValue(300)
    vi.mocked(listMasterEntries).mockResolvedValue({
      hours: [hoursRow(), hoursRow({ id: 12, workDate: '2026-10-25', minutes: 90 })],
      payouts: [
        {
          id: 3,
          masterId: MASTER.id,
          payoutDate: '2026-10-15',
          amount: -500,
          note: 'штраф',
          createdAt: new Date('2026-10-15T10:00:00.000Z'),
        },
      ],
    })
    const res = await req('/api/me/salary?month=2026-10', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(vi.mocked(findMasterByUserId)).toHaveBeenCalledWith('u-emp')
    expect(vi.mocked(listMasterEntries)).toHaveBeenCalledWith(MASTER.id, '2026-10')
    expect(body).toMatchObject({
      ok: true,
      master: { id: MASTER.id, name: 'Петр' },
      hourlyRate: 300,
      totalMinutes: 570,
      hoursSalary: 2850,
      payoutsTotal: -500,
      total: 2350,
      editableFrom: '2026-10-20',
      editableTo: '2026-10-26',
    })
    expect(body.entries.map((e: { kind: string }) => e.kind)).toEqual(['payout', 'hours', 'hours'])
  })

  it('GET /salary для непривязанного аккаунта → 200 с master: null', async () => {
    vi.mocked(findMasterByUserId).mockResolvedValue(undefined)
    const res = await req('/api/me/salary?month=2026-10', 'GET')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, master: null, entries: [], total: 0 })
    expect(vi.mocked(listMasterEntries)).not.toHaveBeenCalled()
  })

  it('GET /salary → 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req('/api/me/salary?month=2026-10', 'GET')
    expect(res.status).toBe(503)
  })

  it('POST /hours записывает часы на привязанного мастера', async () => {
    vi.mocked(createWorkHours).mockResolvedValue(hoursRow({ id: 20, workDate: '2026-10-26' }))
    const res = await req('/api/me/hours', 'POST', { workDate: '2026-10-26', hours: 8 })
    expect(res.status).toBe(201)
    expect(vi.mocked(createWorkHours)).toHaveBeenCalledWith({
      masterId: MASTER.id,
      workDate: '2026-10-26',
      minutes: 480,
      note: '',
    })
  })

  it('POST /hours игнорирует masterId, подброшенный в тело', async () => {
    vi.mocked(createWorkHours).mockResolvedValue(hoursRow())
    await req('/api/me/hours', 'POST', { masterId: 99, workDate: '2026-10-24', hours: 8 })
    expect(vi.mocked(createWorkHours)).toHaveBeenCalledWith(
      expect.objectContaining({ masterId: MASTER.id }),
    )
  })

  it.each([
    ['старше окна', '2026-10-19'],
    ['в будущем', '2026-10-27'],
  ])('POST /hours на день %s → 400 outside_window', async (_label, workDate) => {
    const res = await req('/api/me/hours', 'POST', { workDate, hours: 8 })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'validation', reason: 'outside_window' })
    expect(vi.mocked(createWorkHours)).not.toHaveBeenCalled()
  })

  it('POST /hours для непривязанного аккаунта → 400 not_linked', async () => {
    vi.mocked(findMasterByUserId).mockResolvedValue(undefined)
    const res = await req('/api/me/hours', 'POST', { workDate: '2026-10-26', hours: 8 })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'not_linked' })
  })

  it('POST /hours без ставки → 400 no_rate', async () => {
    vi.mocked(createWorkHours).mockRejectedValue(new SalaryError('no_rate'))
    const res = await req('/api/me/hours', 'POST', { workDate: '2026-10-26', hours: 8 })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'no_rate' })
  })

  it('PATCH /hours/{id} обновляет свою запись внутри окна', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(hoursRow())
    vi.mocked(updateWorkHours).mockResolvedValue(hoursRow({ minutes: 450 }))
    const res = await req('/api/me/hours/11', 'PATCH', { hours: 7.5, workDate: '2026-10-25' })
    expect(res.status).toBe(200)
    expect(vi.mocked(updateWorkHours)).toHaveBeenCalledWith(11, {
      workDate: '2026-10-25',
      minutes: 450,
    })
  })

  it('PATCH /hours/{id} для записи другого мастера → 404', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(hoursRow({ masterId: 7 }))
    const res = await req('/api/me/hours/11', 'PATCH', { hours: 1 })
    expect(res.status).toBe(404)
    expect(vi.mocked(updateWorkHours)).not.toHaveBeenCalled()
  })

  it('PATCH /hours/{id} для записи старше окна → 400 outside_window', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(hoursRow({ workDate: '2026-10-19' }))
    const res = await req('/api/me/hours/11', 'PATCH', { workDate: '2026-10-25' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'outside_window' })
    expect(vi.mocked(updateWorkHours)).not.toHaveBeenCalled()
  })

  it('PATCH /hours/{id} с переносом записи за пределы окна → 400 outside_window', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(hoursRow())
    const res = await req('/api/me/hours/11', 'PATCH', { workDate: '2026-09-30' })
    expect(res.status).toBe(400)
    expect(vi.mocked(updateWorkHours)).not.toHaveBeenCalled()
  })

  it('DELETE /hours/{id} удаляет свою запись внутри окна', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(hoursRow())
    vi.mocked(deleteWorkHours).mockResolvedValue(undefined)
    const res = await req('/api/me/hours/11', 'DELETE')
    expect(res.status).toBe(200)
    expect(vi.mocked(deleteWorkHours)).toHaveBeenCalledWith(11)
  })

  it('DELETE /hours/{id} вне окна → 400, ничего не удалено', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(hoursRow({ workDate: '2026-10-01' }))
    const res = await req('/api/me/hours/11', 'DELETE')
    expect(res.status).toBe(400)
    expect(vi.mocked(deleteWorkHours)).not.toHaveBeenCalled()
  })

  it('DELETE /hours/{id} для несуществующей записи → 404', async () => {
    vi.mocked(getWorkHoursById).mockResolvedValue(undefined)
    const res = await req('/api/me/hours/11', 'DELETE')
    expect(res.status).toBe(404)
  })
})

describe('/api/users', () => {
  beforeEach(() => {
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('доступен только админу', async () => {
    const res = await req('/api/users', 'GET', undefined, await employeeCookie())
    expect(res.status).toBe(403)
    expect(vi.mocked(listAccounts)).not.toHaveBeenCalled()
  })

  it('отдает админу список аккаунтов', async () => {
    const accounts = [
      {
        id: '0b3c6f0e-6f8b-4a8e-9d2f-1c2b3a4d5e6f',
        login: 'petr',
        role: 'employee' as const,
        firstName: 'Петр',
        lastName: '',
      },
    ]
    vi.mocked(listAccounts).mockResolvedValue(accounts)
    const res = await req('/api/users', 'GET', undefined, await adminCookie())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, accounts })
  })
})
