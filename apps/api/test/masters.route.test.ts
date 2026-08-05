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

vi.mock('../src/db/clients.js', () => ({
  upsertClient: vi.fn(),
}))

// Real MasterError so the route's `err instanceof MasterError` mapper works.
vi.mock('../src/db/masters.js', () => {
  class MasterError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'MasterError'
    }
  }
  return {
    MasterError,
    listMasters: vi.fn(),
    createMaster: vi.fn(),
    updateMaster: vi.fn(),
    deleteMaster: vi.fn(),
    reorderMasters: vi.fn(),
  }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import {
  MasterError,
  listMasters,
  createMaster,
  updateMaster,
  deleteMaster,
  reorderMasters,
} from '../src/db/masters.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const master = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  name: 'Иван Содель',
  position: 0,
  canBeResponsible: true,
  paidSalary: true,
  telegramId: null,
  ...over,
})

// Set in beforeEach — every request rides a valid admin session cookie.
let authCookie = ''

function req(
  app: ReturnType<typeof createApp>,
  path: string,
  method: string,
  body?: unknown,
  cookie: string = authCookie,
): Response | Promise<Response> {
  // The list/create routes mount at '/api/masters' exactly — a trailing slash
  // (`/api/masters/`) 404s under Hono's strict matching.
  const suffix = path === '/' ? '' : path
  return app.request(`/api/masters${suffix}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('/api/masters', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp()
    authCookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('GET / without a session cookie → 401', async () => {
    const res = await req(app, '/', 'GET', undefined, '')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
    expect(vi.mocked(listMasters)).not.toHaveBeenCalled()
  })

  it('GET / with an employee session lists masters (read-only, all roles)', async () => {
    vi.mocked(listMasters).mockResolvedValue([master()])
    const res = await req(app, '/', 'GET', undefined, await employeeCookie())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(listMasters)).toHaveBeenCalled()
  })

  it('POST / with an employee session → 403 (writes stay admin-only)', async () => {
    const res = await req(
      app,
      '/',
      'POST',
      { name: 'Новый Мастер', canBeResponsible: true, telegramId: null },
      await employeeCookie(),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
    expect(vi.mocked(createMaster)).not.toHaveBeenCalled()
  })

  it('GET / lists masters', async () => {
    vi.mocked(listMasters).mockResolvedValue([master(), master({ id: 2, name: 'Пётр Новый', position: 1 })])
    const res = await req(app, '/', 'GET')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.masters).toHaveLength(2)
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
  })

  it('POST / creates a master → 201', async () => {
    vi.mocked(createMaster).mockResolvedValue(master({ id: 3, name: 'Новый Мастер' }))
    const res = await req(app, '/', 'POST', {
      name: 'Новый Мастер',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: null,
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.master.name).toBe('Новый Мастер')
  })

  it('POST / persists a telegramId → 201', async () => {
    vi.mocked(createMaster).mockResolvedValue(master({ id: 3, name: 'Новый Мастер', telegramId: '123456789' }))
    const res = await req(app, '/', 'POST', {
      name: 'Новый Мастер',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: '123456789',
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.master.telegramId).toBe('123456789')
    expect(vi.mocked(createMaster)).toHaveBeenCalledWith({
      name: 'Новый Мастер',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: '123456789',
    })
  })

  it('POST / on duplicate name → 409 duplicate_name', async () => {
    vi.mocked(createMaster).mockRejectedValue(new MasterError('duplicate_name'))
    const res = await req(app, '/', 'POST', {
      name: 'Иван Содель',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: null,
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('conflict')
    expect(body.reason).toBe('duplicate_name')
  })

  it('POST / rejects an injection-prefixed name → 400', async () => {
    const res = await req(app, '/', 'POST', { name: '=SUM(A1)' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(createMaster)).not.toHaveBeenCalled()
  })

  it('PATCH /{id} updates a master → 200', async () => {
    vi.mocked(updateMaster).mockResolvedValue(master({ name: 'Иван Содель', canBeResponsible: false, telegramId: '42' }))
    const res = await req(app, '/1', 'PATCH', {
      name: 'Иван Содель',
      canBeResponsible: false,
      paidSalary: true,
      telegramId: '42',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.master.canBeResponsible).toBe(false)
    expect(body.master.telegramId).toBe('42')
  })

  it('PATCH /{id} with an omitted canBeResponsible → 400, does not silently resurrect it to true', async () => {
    const res = await req(app, '/1', 'PATCH', { name: 'Иван Содель', telegramId: null })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(updateMaster)).not.toHaveBeenCalled()
  })

  it('PATCH /{id} on missing row → 404', async () => {
    vi.mocked(updateMaster).mockRejectedValue(new MasterError('not_found'))
    const res = await req(app, '/999', 'PATCH', {
      name: 'Пётр Новый',
      canBeResponsible: true,
      paidSalary: true,
      telegramId: null,
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not_found')
  })

  it('DELETE /{id} → 200', async () => {
    vi.mocked(deleteMaster).mockResolvedValue(undefined)
    const res = await req(app, '/1', 'DELETE')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(deleteMaster)).toHaveBeenCalledWith(1)
  })

  it('DELETE /{id} with recorded work hours → 409 has_work_hours', async () => {
    vi.mocked(deleteMaster).mockRejectedValue(new MasterError('has_work_hours'))
    const res = await req(app, '/1', 'DELETE')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('conflict')
    expect(body.reason).toBe('has_work_hours')
  })

  it('DELETE /{id} with linked bookings → 409 has_bookings', async () => {
    vi.mocked(deleteMaster).mockRejectedValue(new MasterError('has_bookings'))
    const res = await req(app, '/1', 'DELETE')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('conflict')
    expect(body.reason).toBe('has_bookings')
  })

  it('PATCH /reorder → 200', async () => {
    vi.mocked(reorderMasters).mockResolvedValue([master({ id: 2, position: 0 }), master({ id: 1, position: 1 })])
    const res = await req(app, '/reorder', 'PATCH', { ids: [2, 1] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.masters[0].id).toBe(2)
    expect(vi.mocked(reorderMasters)).toHaveBeenCalledWith([2, 1])
  })

  it('PATCH /reorder with an invalid set → 400 invalid_order', async () => {
    vi.mocked(reorderMasters).mockRejectedValue(new MasterError('invalid_order'))
    const res = await req(app, '/reorder', 'PATCH', { ids: [2] })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(body.reason).toBe('invalid_order')
  })

  it.each([
    ['/', 'GET', undefined],
    ['/', 'POST', { name: 'Новый Мастер', canBeResponsible: true, paidSalary: true, telegramId: null }],
    ['/reorder', 'PATCH', { ids: [1] }],
    ['/1', 'PATCH', { name: 'Новый Мастер', canBeResponsible: true, paidSalary: true, telegramId: null }],
    ['/1', 'DELETE', undefined],
  ])('%s %s returns 503 when DB is not ready', async (path, method, body) => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await req(app, path, method, body)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe('unavailable')
  })
})
