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

// Агрегаты приходят СТРОКАМИ, ровно как postgres-js возвращает SUM/COUNT, — маршрут
// обязан привести их к числам (AC13). Две июльские корзины и один пропуск выручки,
// чтобы проверить заполнение нулями (AC14).
const RAW: RawAnalytics = {
  totals: { total: '150000', completedCount: '3', bookingsCount: '5', noClientCount: '1' },
  prevTotal: '100000',
  series: [
    { bucket: '2026-07-01', revenue: '90000', count: '3' },
    { bucket: '2026-07-03', revenue: '60000', count: '2' },
  ],
  retention: { newCount: '2', returningCount: '3' },
  topBySum: [{ clientId: 'c1', name: 'Иван', phone: '+79990000001', sum: '90000', visits: '2' }],
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

  it('возвращает 200 с приведёнными числами, производными метриками и серией, заполненной нулями (AC5, AC13, AC14)', async () => {
    const res = await get(app, '?from=01.07.2026&to=03.07.2026&granularity=day', { Cookie: cookie })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.period).toEqual({ from: '01.07.2026', to: '03.07.2026', granularity: 'day' })

    // Каждый агрегат — число, а не строка (приведение через Number() сработало).
    expect(body.revenue.total).toBe(150000)
    expect(typeof body.revenue.total).toBe('number')
    expect(body.revenue.completedCount).toBe(3)
    expect(body.revenue.bookingsCount).toBe(5)
    // avgCheck = round(150000 / 3).
    expect(body.revenue.avgCheck).toBe(50000)
    // delta % = (150000 − 100000) / 100000 × 100 = 50.0.
    expect(body.revenue.delta).toEqual({ revenuePct: 50, prevTotal: 100000 })

    // Заполнение нулями: 3 дневные корзины, 2-я — пропущенная (0/0).
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

  it('возвращает 503, если БД не готова, не выполняя запросов (AC6)', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await get(app, '?from=01.07.2026&to=31.07.2026', { Cookie: cookie })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unavailable')
    expect(body.reason).toBe('not_configured')
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('возвращает 401 без auth-cookie (AC7)', async () => {
    const res = await get(app, '?from=01.07.2026&to=31.07.2026', {})
    expect(res.status).toBe(401)
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('возвращает 403 для роли не-админа (AC7)', async () => {
    const res = await get(app, '?from=01.07.2026&to=31.07.2026', { Cookie: await employeeCookie() })
    expect(res.status).toBe(403)
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('возвращает 400 при некорректной дате from (AC8)', async () => {
    const res = await get(app, '?from=2026-07-01&to=31.07.2026', { Cookie: cookie })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation')
    expect(vi.mocked(getAnalyticsOverview)).not.toHaveBeenCalled()
  })

  it('по умолчанию берёт гранулярность day, если она не указана', async () => {
    await get(app, '?from=01.07.2026&to=03.07.2026', { Cookie: cookie })
    expect(vi.mocked(getAnalyticsOverview)).toHaveBeenCalledWith(
      expect.objectContaining({ granularity: 'day', fromIso: '2026-07-01', toIso: '2026-07-03' }),
    )
  })

  it('вычисляет непосредственно предшествующий период той же длины', async () => {
    await get(app, '?from=08.07.2026&to=14.07.2026', { Cookie: cookie })
    // 7-дневный период → prev = 01.07..07.07.
    expect(vi.mocked(getAnalyticsOverview)).toHaveBeenCalledWith(
      expect.objectContaining({ prevFromIso: '2026-07-01', prevToIso: '2026-07-07' }),
    )
  })

  it('пустой период → avgCheck 0, revenuePct null, repeatRate null, серия заполнена нулями (AC9, AC10)', async () => {
    vi.mocked(getAnalyticsOverview).mockResolvedValue({
      totals: { total: '0', completedCount: '0', bookingsCount: '0', noClientCount: '0' },
      prevTotal: '0',
      series: [],
      retention: { newCount: '0', returningCount: '0' },
      topBySum: [],
    })
    const res = await get(app, '?from=01.07.2026&to=03.07.2026&granularity=day', { Cookie: cookie })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.revenue.avgCheck).toBe(0)
    expect(body.revenue.delta.revenuePct).toBeNull()
    expect(body.clients.repeatRate).toBeNull()
    // Серия заполнена нулями на весь диапазон, а не пуста.
    expect(body.revenue.series).toEqual([
      { bucket: '2026-07-01', revenue: 0, count: 0 },
      { bucket: '2026-07-02', revenue: 0, count: 0 },
      { bucket: '2026-07-03', revenue: 0, count: 0 },
    ])
  })
})
