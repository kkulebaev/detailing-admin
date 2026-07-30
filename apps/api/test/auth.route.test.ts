import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

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

vi.mock('../src/notify.js', () => ({
  notifyMaster: vi.fn(),
}))

vi.mock('../src/db/clients.js', () => ({
  upsertClient: vi.fn(),
  listClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  ClientError: class ClientError extends Error {},
}))

vi.mock('../src/db/users.js', () => {
  class UserError extends Error {
    constructor(public readonly code: string) {
      super(code)
      this.name = 'UserError'
    }
  }
  return {
    UserError,
    findByLogin: vi.fn(),
    createUser: vi.fn(),
    updatePasswordHash: vi.fn(),
    updateProfile: vi.fn(),
    resetPasswordByLogin: vi.fn(),
  }
})

import { createApp } from '../src/server.js'
import { _clearForTest } from '../src/idempotency.js'
import { isDbReady } from '../src/boot.js'
import { appendBooking } from '../src/sheets.js'
import { listClients } from '../src/db/clients.js'
import { findByLogin, updatePasswordHash, updateProfile } from '../src/db/users.js'
import { hashPassword } from '../src/auth/password.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const ORIGIN = 'http://localhost:5173'

// A stored user with a real scrypt hash of 'secret123'.
let adminUser: {
  id: string
  login: string
  passwordHash: string
  role: string
  firstName: string
  lastName: string
  createdAt: Date
  passwordChangedAt: Date
}

beforeAll(async () => {
  adminUser = {
    id: '11111111-1111-1111-1111-111111111111',
    login: 'admin',
    passwordHash: await hashPassword('secret123'),
    role: 'admin',
    firstName: 'Админ',
    lastName: 'Главный',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
  }
})

function json(app: ReturnType<typeof createApp>, path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/auth/login', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('valid credentials → 200 with user and a Set-Cookie', async () => {
    vi.mocked(findByLogin).mockResolvedValue(adminUser as never)
    const res = await json(app, '/api/auth/login', 'POST', { login: 'admin', password: 'secret123' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      user: { login: 'admin', role: 'admin', firstName: 'Админ', lastName: 'Главный' },
    })
  })

  it('wrong password → 401, no cookie', async () => {
    vi.mocked(findByLogin).mockResolvedValue(adminUser as never)
    const res = await json(app, '/api/auth/login', 'POST', { login: 'admin', password: 'nope' })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('unknown login → 401 (same shape, dummy verify runs)', async () => {
    vi.mocked(findByLogin).mockResolvedValue(null as never)
    const res = await json(app, '/api/auth/login', 'POST', { login: 'ghost', password: 'whatever' })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  it('DB down → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await json(app, '/api/auth/login', 'POST', { login: 'admin', password: 'secret123' })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('unavailable')
  })

  it('missing fields → 400 validation', async () => {
    const res = await json(app, '/api/auth/login', 'POST', { login: 'admin' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
  })
})

describe('GET /api/auth/me', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
  })

  it('no cookie → 401', async () => {
    const res = await json(app, '/api/auth/me', 'GET')
    expect(res.status).toBe(401)
  })

  it('valid cookie → user, without any DB read', async () => {
    const res = await json(app, '/api/auth/me', 'GET', undefined, {
      Cookie: await adminCookie({ firstName: 'Админ', lastName: 'Главный' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      user: { login: 'admin', role: 'admin', firstName: 'Админ', lastName: 'Главный' },
    })
    expect(vi.mocked(findByLogin)).not.toHaveBeenCalled()
    // Sliding refresh re-issues the cookie.
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=')
  })

  it('malformed cookie → 401', async () => {
    const res = await json(app, '/api/auth/me', 'GET', undefined, { Cookie: 'auth_token=garbage' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the cookie and is idempotent (no session needed)', async () => {
    const app = createApp()
    const res = await json(app, '/api/auth/logout', 'POST')
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=')
    expect(setCookie).toMatch(/Max-Age=0|Expires=/i)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})

describe('POST /api/auth/change-password', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('no session → 401', async () => {
    const res = await json(app, '/api/auth/change-password', 'POST', {
      currentPassword: 'secret123',
      newPassword: 'brandnew123',
    })
    expect(res.status).toBe(401)
  })

  it('DB down → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await json(app, '/api/auth/change-password', 'POST', {
      currentPassword: 'secret123',
      newPassword: 'brandnew123',
    }, { Cookie: await adminCookie() })
    expect(res.status).toBe(503)
  })

  it('wrong current password → 400 validation on currentPassword', async () => {
    vi.mocked(findByLogin).mockResolvedValue(adminUser as never)
    const res = await json(app, '/api/auth/change-password', 'POST', {
      currentPassword: 'WRONG',
      newPassword: 'brandnew123',
    }, { Cookie: await adminCookie() })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect((body.issues as Array<{ path: unknown[] }>).some((i) => i.path.includes('currentPassword'))).toBe(true)
    expect(vi.mocked(updatePasswordHash)).not.toHaveBeenCalled()
  })

  it('correct current password → 200 and updates the hash', async () => {
    vi.mocked(findByLogin).mockResolvedValue(adminUser as never)
    vi.mocked(updatePasswordHash).mockResolvedValue(true)
    const res = await json(app, '/api/auth/change-password', 'POST', {
      currentPassword: 'secret123',
      newPassword: 'brandnew123',
    }, { Cookie: await adminCookie() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(vi.mocked(updatePasswordHash)).toHaveBeenCalledTimes(1)
  })

  it('lost concurrent-change race (rowCount 0) → 409 stale_password', async () => {
    vi.mocked(findByLogin).mockResolvedValue(adminUser as never)
    vi.mocked(updatePasswordHash).mockResolvedValue(false)
    const res = await json(app, '/api/auth/change-password', 'POST', {
      currentPassword: 'secret123',
      newPassword: 'brandnew123',
    }, { Cookie: await adminCookie() })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'conflict', reason: 'stale_password' })
  })
})

describe('PATCH /api/auth/me', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('no session → 401', async () => {
    const res = await json(app, '/api/auth/me', 'PATCH', { firstName: 'Иван', lastName: 'Петров' })
    expect(res.status).toBe(401)
    expect(vi.mocked(updateProfile)).not.toHaveBeenCalled()
  })

  it('DB down → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await json(app, '/api/auth/me', 'PATCH', { firstName: 'Иван', lastName: 'Петров' }, {
      Cookie: await adminCookie(),
    })
    expect(res.status).toBe(503)
  })

  it('blank name → 400 validation', async () => {
    const res = await json(app, '/api/auth/me', 'PATCH', { firstName: '  ', lastName: 'Петров' }, {
      Cookie: await adminCookie(),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(updateProfile)).not.toHaveBeenCalled()
  })

  it('valid → 200 with updated user and a re-minted cookie', async () => {
    vi.mocked(updateProfile).mockResolvedValue({
      ...adminUser,
      firstName: 'Иван',
      lastName: 'Петров',
    } as never)
    const res = await json(app, '/api/auth/me', 'PATCH', { firstName: 'Иван', lastName: 'Петров' }, {
      Cookie: await adminCookie(),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      user: { login: 'admin', role: 'admin', firstName: 'Иван', lastName: 'Петров' },
    })
    expect(vi.mocked(updateProfile)).toHaveBeenCalledWith('u-admin', {
      firstName: 'Иван',
      lastName: 'Петров',
    })
    // Re-mint so the DB-free /me carries the new name without a re-login.
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=')
  })

  it('account vanished between sign-in and now → 401', async () => {
    vi.mocked(updateProfile).mockResolvedValue(null)
    const res = await json(app, '/api/auth/me', 'PATCH', { firstName: 'Иван', lastName: 'Петров' }, {
      Cookie: await adminCookie(),
    })
    expect(res.status).toBe(401)
  })
})

describe('guards on existing routes', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('GET /api/clients without a cookie → 401 (with CORS credentials header)', async () => {
    const res = await json(app, '/api/clients', 'GET')
    expect(res.status).toBe(401)
    // SPA must be able to read the rejection — Allow-Credentials rides on 401.
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(vi.mocked(listClients)).not.toHaveBeenCalled()
  })

  it('GET /api/clients with an employee session → 403', async () => {
    const res = await json(app, '/api/clients', 'GET', undefined, { Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
    expect(vi.mocked(listClients)).not.toHaveBeenCalled()
  })

  it('GET /api/clients with an admin session → 200', async () => {
    vi.mocked(listClients).mockResolvedValue([])
    const res = await json(app, '/api/clients', 'GET', undefined, { Cookie: await adminCookie() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(listClients)).toHaveBeenCalledTimes(1)
  })
})

describe('booking invariant — stays alive when Postgres is down', () => {
  it('valid admin JWT + DB down → POST /api/bookings reaches Sheets (201)', async () => {
    const app = createApp()
    _clearForTest()
    vi.mocked(isDbReady).mockReturnValue(false)
    vi.mocked(appendBooking).mockResolvedValue({
      ok: true,
      updatedRange: 'Запись 2026!A5',
      updatedRow: 5,
      latencyMs: 12,
      statusCode: 200,
    })

    const res = await json(
      app,
      '/api/bookings',
      'POST',
      {
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
      },
      { 'Idempotency-Key': 'invariant-key', Cookie: await adminCookie() },
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(appendBooking)).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe('ADR consequences (stateless sessions)', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
  })

  it('a previously issued JWT stays valid until TTL after a password change', async () => {
    const oldCookie = await adminCookie()

    // Perform a successful password change with that session.
    vi.mocked(findByLogin).mockResolvedValue(adminUser as never)
    vi.mocked(updatePasswordHash).mockResolvedValue(true)
    const changed = await json(app, '/api/auth/change-password', 'POST', {
      currentPassword: 'secret123',
      newPassword: 'brandnew123',
    }, { Cookie: oldCookie })
    expect(changed.status).toBe(200)

    // The OLD token is not revoked server-side — it still authenticates.
    vi.mocked(listClients).mockResolvedValue([])
    const res = await json(app, '/api/clients', 'GET', undefined, { Cookie: oldCookie })
    expect(res.status).toBe(200)
  })

  it('after logout the cleared cookie no longer authenticates → 401', async () => {
    const logout = await json(app, '/api/auth/logout', 'POST')
    expect(logout.status).toBe(200)
    // Browser has dropped/emptied auth_token; the next request carries no valid token.
    const res = await json(app, '/api/auth/me', 'GET', undefined, { Cookie: 'auth_token=' })
    expect(res.status).toBe(401)
  })
})

describe('/healthz stays public', () => {
  it('no auth required', async () => {
    const app = createApp()
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
  })
})
