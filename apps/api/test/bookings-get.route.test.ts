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
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
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

// toBookingRow настоящий: маршрут прогоняет через него скрытие сумм по роли.
vi.mock('../src/db/bookings.js', async (importActual) => ({
  ...(await importActual<typeof import('../src/db/bookings.js')>()),
  getBooking: vi.fn(),
  listBookingJournal: vi.fn().mockResolvedValue([]),
  listDeletedBookings: vi.fn().mockResolvedValue([]),
  listBookings: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}))

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import { getBooking, type BookingWithCreator } from '../src/db/bookings.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const ROW: BookingWithCreator = {
  id: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'key-1',
  clientId: null,
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  note: '',
  amount: 5000,
  amountFormula: null,
  discount: 0,
  dateFrom: '2026-06-04',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  readiness: '',
  master: ['Иван Содель'],
  responsible: 'Иван Содель',
  responsibleId: 7,
  carId: 'car-uuid-1',
  carClass: 3,
  sheetRow: 5,
  sheetRange: 'Запись 2026!A5',
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
  createdBy: 'Админ',
  services: [],
}

// Цель ссылок из уведомлений: одна запись по id мимо фильтров списка.
describe('GET /api/bookings/{id}', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
    vi.mocked(getBooking).mockReset()
  })

  const get = async (path: string, cookie?: string) =>
    app.request(path, { headers: { Cookie: cookie ?? (await adminCookie()) } })

  it('отдает запись любой роли, суммы только тем, кому их видно (6j)', async () => {
    vi.mocked(getBooking).mockResolvedValue(ROW)
    const res = await get(`/api/bookings/${ROW.id}`, await employeeCookie())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.booking).toMatchObject({ id: ROW.id, name: 'Иван' })
    expect(body.booking.amount).toBeUndefined()
    expect(body.booking.carId).toBeUndefined()
    expect(vi.mocked(getBooking)).toHaveBeenCalledWith(ROW.id)

    const asAdmin = await (await get(`/api/bookings/${ROW.id}`)).json()
    expect(asAdmin.booking.amount).toBe(5000)
  })

  it('удаленная запись → 404', async () => {
    vi.mocked(getBooking).mockResolvedValue(null)
    const res = await get(`/api/bookings/${ROW.id}`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' })
  })

  it('не перехватывает статические пути', async () => {
    expect((await get('/api/bookings/journal')).status).toBe(200)
    expect((await get('/api/bookings/deleted')).status).toBe(200)
    expect((await get('/api/bookings/export')).status).toBe(200)
    expect(vi.mocked(getBooking)).not.toHaveBeenCalled()
  })

  it('без базы → 503', async () => {
    vi.mocked(isDbReady).mockReturnValue(false)
    expect((await get(`/api/bookings/${ROW.id}`)).status).toBe(503)
  })
})
