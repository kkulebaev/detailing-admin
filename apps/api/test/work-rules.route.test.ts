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

// Настоящий WorkRuleError, чтобы в роуте работал маппинг `err instanceof WorkRuleError`.
vi.mock('../src/db/work-rules.js', () => {
  class WorkRuleError extends Error {
    constructor(
      public readonly code: string,
      public readonly path: (string | number)[] = [],
    ) {
      super(code)
      this.name = 'WorkRuleError'
    }
  }
  return { WorkRuleError, listWorkRules: vi.fn(), replaceMasterWorkRules: vi.fn() }
})

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { WorkRuleError, listWorkRules, replaceMasterWorkRules } from '../src/db/work-rules.js'
import { adminCookie, bookerCookie, employeeCookie } from './auth-helpers.js'

const rule = { sectionId: 1, serviceId: null, kind: 'percent' as const, percent: 40 }

async function put(body: unknown, cookie?: string, masterId = '3') {
  return createApp().request(`/api/salaries/work-rules/${masterId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie ?? (await adminCookie()) },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(isDbReady).mockReturnValue(true)
  vi.mocked(listWorkRules).mockReset()
  vi.mocked(replaceMasterWorkRules).mockReset()
})

describe('/api/salaries/work-rules', () => {
  it('GET закрыт для employee и booker: там проценты мастеров', async () => {
    for (const cookie of [await employeeCookie(), await bookerCookie()]) {
      const res = await createApp().request('/api/salaries/work-rules', {
        headers: { Cookie: cookie },
      })
      expect(res.status).toBe(403)
    }
    expect(listWorkRules).not.toHaveBeenCalled()
  })

  it('GET отдает правила админу', async () => {
    vi.mocked(listWorkRules).mockResolvedValue([{ masterId: 3, ...rule }])
    const res = await createApp().request('/api/salaries/work-rules', {
      headers: { Cookie: await adminCookie() },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, rules: [{ masterId: 3, ...rule }] })
  })

  it('GET без базы → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await createApp().request('/api/salaries/work-rules', {
      headers: { Cookie: await adminCookie() },
    })
    expect(res.status).toBe(503)
  })

  it('PUT заменяет правила мастера', async () => {
    vi.mocked(replaceMasterWorkRules).mockResolvedValue([{ masterId: 3, ...rule }])
    const res = await put({ rules: [rule] })
    expect(res.status).toBe(200)
    expect(replaceMasterWorkRules).toHaveBeenCalledWith(3, [rule])
  })

  it('PUT от employee → 403', async () => {
    const res = await put({ rules: [rule] }, await employeeCookie())
    expect(res.status).toBe(403)
    expect(replaceMasterWorkRules).not.toHaveBeenCalled()
  })

  it('PUT с повтором вида работ → 400 до базы', async () => {
    const res = await put({ rules: [rule, { ...rule, percent: 30 }] })
    expect(res.status).toBe(400)
    expect(replaceMasterWorkRules).not.toHaveBeenCalled()
  })

  it('PUT архивному или неизвестному мастеру → 404', async () => {
    vi.mocked(replaceMasterWorkRules).mockRejectedValue(new WorkRuleError('master_not_found'))
    const res = await put({ rules: [rule] })
    expect(res.status).toBe(404)
  })

  it('PUT с разделом, которого нет в прайсе → 400 с путем поля', async () => {
    vi.mocked(replaceMasterWorkRules).mockRejectedValue(
      new WorkRuleError('unknown_target', ['rules', 0, 'sectionId']),
    )
    const res = await put({ rules: [rule] })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { issues: { path: unknown[] }[] }
    expect(body.issues[0]?.path).toEqual(['rules', 0, 'sectionId'])
  })
})
