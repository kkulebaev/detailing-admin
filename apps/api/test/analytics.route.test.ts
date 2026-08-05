import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    AUTH_REMEMBER_TTL_SECONDS: 2592000,
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

vi.mock('../src/db/analytics.js', () => ({
  getAnalyticsOverview: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { getAnalyticsOverview, type RawAnalytics } from '../src/db/analytics.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

// Aggregates arrive as STRINGS, exactly as postgres-js returns SUM/COUNT — the
// route must coerce them (AC13). Two July buckets, one revenue gap to exercise
// zero-fill (AC14).
const RAW: RawAnalytics = {
  totals: { total: '150000', completedCount: '3', bookingsCount: '5', noClientCount: '1' },
  prevTotal: '100000',
  series: [
    { bucket: '2026-07-01', revenue: '90000', count: '3' },
    { bucket: '2026-07-03', revenue: '60000', count: '2' },
  ],
  retention: { newCount: '2', returningCount: '3' },
  topBySum: [
    { clientId: 'c1', name: 'Иван', phone: '+79990000001', sum: '90000', visits: '2' },
  ],
  topByVisits: [
    { clientId: 'c1', name: 'Иван', phone: '+79990000001', sum: '90000', visits: '2' },
  ],
}

function get(
  app: ReturnType<typeof createApp>,
  query: string,
  headers: Record<string, string>,
): Response | Promise<Response> {
  return app.request(`/api/analytics/overview${query}`, { method: 'GET', headers })
}

describe('GET /api/analytics/overview', () => {
  let app: ReturnType<typeof createApp>
  let cookie = ''

  beforeEach(async () => {
    app = createApp()
    cookie = await adminCookie()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(getAnalyticsOverview).mockResolvedValue(RAW)
  })

  it('returns 200 with coerced numbers, derived metrics and a zero-filled series (AC5, AC13, AC14)', async () => {
    const res = await get(app, '?from=01.07.2026&to=03.07.2026&granularity=day', { Cookie: cookie })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.period).toEqual({ from: '01.07.2026', to: '03.07.2026', granularity: 'day' })

    // Every aggregate is a number, not a string (Number() coercion ran).
    expect(body.revenue.total).toBe(150000)
    expect(typeof body.revenue.total).toBe('number')
    expect(body.revenue.completedCount).toBe(3)
    expect(body.revenue.bookingsCount).toBe(5)
    // avgCheck = round(150000 / 3).
    expect(body.revenue.avgCheck).toBe(50000)
    // delta % = (150000 − 100000) / 100000 × 100 = 50.0.
    expect(body.revenue.delta).toEqual({ revenuePct: 50, prevTotal: 100000 })

    // Zero-fill: 3 daily buckets, the 2nd is the missing one (0/0).
    expect(body.revenue.series).toEqual([
      { bucket: '2026-07-01', revenue: 90000, count: 3 },
      { bucket: '2026-07-02', revenue: 0, count: 0 },
      { bucket: '2026-07-03', revenue: 60000, count: 2 },
    ])

    // repeatRate = 3 / (2 + 3) × 100 = 60.0.
    expect(body.clients).toMatchObject({
      newCount: 2,
      returningCount: 3,
      noClientCount: 1,
      repeatRate: 60,
    })
    expect(body.clients.topBySum[0]).toEqual({
      clientId: 'c1',
      name: 'Иван',
      phone: '+79990000001',
      sum: 90000,
      visits: 2,
    })
  })

  it('returns 503 when the DB is not ready, without querying (AC6)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await get(app, '?from=01.07.2026&to=31.07.2026', { Cookie: cookie })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('not_configured')
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('returns 401 without an auth cookie (AC7)', async () => {
    const res = await get(app, '?from=01.07.2026&to=31.07.2026', {})
    expect(res.status).toBe(401)
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin role (AC7)', async () => {
    const res = await get(app, '?from=01.07.2026&to=31.07.2026', { Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('returns 400 on a malformed from date (AC8)', async () => {
    const res = await get(app, '?from=2026-07-01&to=31.07.2026', { Cookie: cookie })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('defaults granularity to day when omitted', async () => {
    await get(app, '?from=01.07.2026&to=03.07.2026', { Cookie: cookie })
    expect(vi.mocked(getAnalyticsOverview)).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: 'day', fromIso: '2026-07-01', toIso: '2026-07-03' }),
    )
  })

  it('computes the immediately-preceding previous period of equal length', async () => {
    await get(app, '?from=08.07.2026&to=14.07.2026', { Cookie: cookie })
    // 7-day period → prev = 01.07..07.07.
    expect(vi.mocked(getAnalyticsOverview)).toHaveBeenCalledWith(
      expect.objectContaining({ prevFromIso: '2026-07-01', prevToIso: '2026-07-07' }),
    )
  })

  it('empty period → avgCheck 0, revenuePct null, repeatRate null, zero-filled series (AC9, AC10)', async () => {
    vi.mocked(getAnalyticsOverview).mockResolvedValue({
      totals: { total: '0', completedCount: '0', bookingsCount: '0', noClientCount: '0' },
      prevTotal: '0',
      series: [],
      retention: { newCount: '0', returningCount: '0' },
      topBySum: [],
      topByVisits: [],
    })
    const res = await get(app, '?from=01.07.2026&to=03.07.2026&granularity=day', { Cookie: cookie })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.revenue.avgCheck).toBe(0)
    expect(body.revenue.delta.revenuePct).toBeNull()
    expect(body.clients.repeatRate).toBeNull()
    // Series is zero-filled across the whole range, not empty.
    expect(body.revenue.series).toEqual([
      { bucket: '2026-07-01', revenue: 0, count: 0 },
      { bucket: '2026-07-02', revenue: 0, count: 0 },
      { bucket: '2026-07-03', revenue: 0, count: 0 },
    ])
  })
})
