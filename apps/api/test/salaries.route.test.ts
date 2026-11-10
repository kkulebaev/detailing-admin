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

// Настоящий SalaryError, чтобы в роуте работал маппинг `err instanceof SalaryError`.
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
    listMasterEntries: vi.fn(),
    createWorkHours: vi.fn(),
    updateWorkHours: vi.fn(),
    deleteWorkHours: vi.fn(),
    createPayout: vi.fn(),
    updatePayout: vi.fn(),
    deletePayout: vi.fn(),
  }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import {
  SalaryError,
  listSalaries,
  setMasterRate,
  listMasterEntries,
  createWorkHours,
  updateWorkHours,
  deleteWorkHours,
  createPayout,
  updatePayout,
  deletePayout,
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

const payoutRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 9,
  masterId: 1,
  payoutDate: '2026-07-05',
  amount: -2000,
  note: '',
  createdAt: new Date('2026-07-05T09:00:00.000Z'),
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
    authCookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('GET без cookie сессии → 401', async () => {
    const res = await req('?month=2026-07', 'GET', undefined, '')
    expect(res.status).toBe(401)
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('GET с сессией employee → 403 (зарплаты только для админа)', async () => {
    const res = await req('?month=2026-07', 'GET', undefined, await employeeCookie())
    expect(res.status).toBe(403)
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('GET возвращает 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req('?month=2026-07', 'GET')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('GET отдает зарплаты за месяц → 200', async () => {
    vi.mocked(listSalaries).mockResolvedValue([
      {
        masterId: 1,
        masterName: 'Иван',
        hourlyRate: 150,
        totalMinutes: 480,
        hoursSalary: 1200,
        payoutsTotal: -2000,
        total: -800,
      },
    ])
    const res = await req('?month=2026-07', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.month).toBe('2026-07')
    expect(body.rows[0].hoursSalary).toBe(1200)
    expect(body.rows[0].payoutsTotal).toBe(-2000)
    expect(body.rows[0].total).toBe(-800)
    expect(vi.mocked(listSalaries)).toHaveBeenCalledWith('2026-07')
  })

  it('GET с некорректным месяцем → 400 validation', async () => {
    const res = await req('?month=2026-13', 'GET')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(listSalaries)).not.toHaveBeenCalled()
  })

  it('PATCH /rates задает ставку методом PATCH → 200', async () => {
    vi.mocked(setMasterRate).mockResolvedValue(undefined)
    const res = await req('/rates', 'PATCH', { masterId: 1, hourlyRate: 500 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(setMasterRate)).toHaveBeenCalledWith(1, 500)
  })

  it('PATCH /rates для несуществующего мастера → 404', async () => {
    vi.mocked(setMasterRate).mockRejectedValue(new SalaryError('master_not_found'))
    const res = await req('/rates', 'PATCH', { masterId: 999, hourlyRate: 500 })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('PATCH /rates со ставкой 0 → 400 validation', async () => {
    const res = await req('/rates', 'PATCH', { masterId: 1, hourlyRate: 0 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(setMasterRate)).not.toHaveBeenCalled()
  })

  it('GET /entries без cookie сессии → 401', async () => {
    const res = await req('/entries?masterId=1&month=2026-07', 'GET', undefined, '')
    expect(res.status).toBe(401)
    expect(vi.mocked(listMasterEntries)).not.toHaveBeenCalled()
  })

  it('GET /entries с сессией employee → 403', async () => {
    const res = await req(
      '/entries?masterId=1&month=2026-07',
      'GET',
      undefined,
      await employeeCookie(),
    )
    expect(res.status).toBe(403)
    expect(vi.mocked(listMasterEntries)).not.toHaveBeenCalled()
  })

  it('GET /entries возвращает 503, если БД не готова', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req('/entries?masterId=1&month=2026-07', 'GET')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
    expect(vi.mocked(listMasterEntries)).not.toHaveBeenCalled()
  })

  it('GET /entries сливает часы и выплаты в одну отсортированную ленту → 200', async () => {
    vi.mocked(listMasterEntries).mockResolvedValue({
      hours: [workHoursRow()],
      payouts: [payoutRow(), payoutRow({ id: 10, payoutDate: '2026-07-10', amount: 5000 })],
    })
    const res = await req('/entries?masterId=1&month=2026-07', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Сначала выплата за 05.07; за 10.07 строка часов идет раньше выплаты.
    expect(body.entries.map((e: { kind: string; id: number }) => [e.kind, e.id])).toEqual([
      ['payout', 9],
      ['hours', 5],
      ['payout', 10],
    ])
    expect(body.entries[0].createdAt).toBe('2026-07-05T09:00:00.000Z')
    expect(body.entries[1].createdAt).toBe('2026-07-10T08:00:00.000Z')
    expect(vi.mocked(listMasterEntries)).toHaveBeenCalledWith(1, '2026-07')
  })

  it('POST /hours добавляет запись (часы → минуты) → 201', async () => {
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
    // hours 8 → 480 минут на входе.
    expect(vi.mocked(createWorkHours)).toHaveBeenCalledWith({
      masterId: 1,
      workDate: '2026-07-10',
      minutes: 480,
      note: 'смена',
    })
  })

  it('POST /hours для мастера без ставки → 400 validation no_rate', async () => {
    vi.mocked(createWorkHours).mockRejectedValue(new SalaryError('no_rate'))
    const res = await req('/hours', 'POST', { masterId: 1, workDate: '2026-07-10', hours: 8 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(body.reason).toBe('no_rate')
  })

  it('POST /hours с часами вне сетки → 400 validation', async () => {
    const res = await req('/hours', 'POST', { masterId: 1, workDate: '2026-07-10', hours: 7.1 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(createWorkHours)).not.toHaveBeenCalled()
  })

  it('PATCH /hours/{id} редактирует запись → 200', async () => {
    vi.mocked(updateWorkHours).mockResolvedValue(workHoursRow({ minutes: 300, note: 'fix' }))
    const res = await req('/hours/5', 'PATCH', { hours: 5, note: 'fix' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // hours 5 → 300 минут; masterId/ставка при редактировании не передаются.
    expect(vi.mocked(updateWorkHours)).toHaveBeenCalledWith(5, { minutes: 300, note: 'fix' })
  })

  it('PATCH /hours/{id} для несуществующей записи → 404', async () => {
    vi.mocked(updateWorkHours).mockRejectedValue(new SalaryError('not_found'))
    const res = await req('/hours/999', 'PATCH', { hours: 5 })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('DELETE /hours/{id} удаляет запись → 200', async () => {
    vi.mocked(deleteWorkHours).mockResolvedValue(undefined)
    const res = await req('/hours/5', 'DELETE')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(deleteWorkHours)).toHaveBeenCalledWith(5)
  })

  it('POST /payouts без cookie сессии → 401', async () => {
    const res = await req(
      '/payouts',
      'POST',
      { masterId: 1, payoutDate: '2026-07-05', amount: 2000 },
      '',
    )
    expect(res.status).toBe(401)
    expect(vi.mocked(createPayout)).not.toHaveBeenCalled()
  })

  it('POST /payouts с сессией employee → 403 (зарплаты только для админа)', async () => {
    const res = await req(
      '/payouts',
      'POST',
      { masterId: 1, payoutDate: '2026-07-05', amount: 2000 },
      await employeeCookie(),
    )
    expect(res.status).toBe(403)
    expect(vi.mocked(createPayout)).not.toHaveBeenCalled()
  })

  it('POST /payouts с нулевой суммой → 400 validation', async () => {
    const res = await req('/payouts', 'POST', { masterId: 1, payoutDate: '2026-07-05', amount: 0 })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(createPayout)).not.toHaveBeenCalled()
  })

  it('POST /payouts с отрицательной суммой (удержание) → 201', async () => {
    vi.mocked(createPayout).mockResolvedValue(payoutRow())
    const res = await req('/payouts', 'POST', {
      masterId: 1,
      payoutDate: '2026-07-05',
      amount: -2000,
      note: 'удержание',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.payout.amount).toBe(-2000)
    expect(body.payout.createdAt).toBe('2026-07-05T09:00:00.000Z')
    // Знак переживает round-trip — удержание не должно превратиться в премию.
    expect(vi.mocked(createPayout)).toHaveBeenCalledWith({
      masterId: 1,
      payoutDate: '2026-07-05',
      amount: -2000,
      note: 'удержание',
    })
  })

  it('POST /payouts для неизвестного мастера → 404', async () => {
    vi.mocked(createPayout).mockRejectedValue(new SalaryError('master_not_found'))
    const res = await req('/payouts', 'POST', {
      masterId: 999,
      payoutDate: '2026-07-05',
      amount: 5000,
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('PATCH /payouts/{id} редактирует выплату → 200', async () => {
    vi.mocked(updatePayout).mockResolvedValue(payoutRow({ amount: 3000, note: 'премия' }))
    const res = await req('/payouts/9', 'PATCH', { amount: 3000, note: 'премия' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.payout.amount).toBe(3000)
    // masterId при редактировании не передается.
    expect(vi.mocked(updatePayout)).toHaveBeenCalledWith(9, { amount: 3000, note: 'премия' })
  })

  it('PATCH /payouts/{id} для несуществующей выплаты → 404', async () => {
    vi.mocked(updatePayout).mockRejectedValue(new SalaryError('not_found'))
    const res = await req('/payouts/999', 'PATCH', { amount: 3000 })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('DELETE /payouts/{id} удаляет выплату → 200', async () => {
    vi.mocked(deletePayout).mockResolvedValue(undefined)
    const res = await req('/payouts/9', 'DELETE')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(deletePayout)).toHaveBeenCalledWith(9)
  })

  it('DELETE /payouts/{id} для несуществующей выплаты → 404', async () => {
    vi.mocked(deletePayout).mockRejectedValue(new SalaryError('not_found'))
    const res = await req('/payouts/999', 'DELETE')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it.each([
    ['?month=2026-07', 'GET', undefined],
    ['/rates', 'PATCH', { masterId: 1, hourlyRate: 500 }],
    ['/entries?masterId=1&month=2026-07', 'GET', undefined],
    ['/hours', 'POST', { masterId: 1, workDate: '2026-07-10', hours: 8 }],
    ['/hours/5', 'PATCH', { hours: 5 }],
    ['/hours/5', 'DELETE', undefined],
    ['/payouts', 'POST', { masterId: 1, payoutDate: '2026-07-05', amount: -2000 }],
    ['/payouts/9', 'PATCH', { amount: 3000 }],
    ['/payouts/9', 'DELETE', undefined],
  ])('%s %s возвращает 503, если БД не готова', async (path, method, body) => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req(path, method, body)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('unavailable')
  })
})
