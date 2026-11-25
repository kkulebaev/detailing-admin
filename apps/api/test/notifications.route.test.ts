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

vi.mock('../src/notifications/store.js', () => ({
  listNotifications: vi.fn(),
  countUnreadNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  insertNotifications: vi.fn(),
  masterAccounts: vi.fn(),
  adminUserIds: vi.fn(),
  notifyMoney: vi.fn(),
}))

import { createApp } from '../src/server.js'
import { isDbReady } from '../src/boot.js'
import type { NotificationRow } from '../src/db/schema.js'
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../src/notifications/store.js'
import { adminCookie, employeeCookie } from './auth-helpers.js'

const row = (id: number, over: Partial<NotificationRow> = {}): NotificationRow => ({
  id,
  userId: 'u-emp',
  type: 'booking.assigned',
  title: 'Новая запись',
  body: '26.11, 10:00 · Иван · Kia Rio',
  link: '/bookings?booking=bk1',
  pushBody: '26.11, 10:00 · Kia Rio',
  createdAt: new Date('2026-11-25T08:00:00.000Z'),
  readAt: null,
  deliveredAt: null,
  ...over,
})

describe('/api/notifications', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp()
    vi.mocked(isDbReady).mockReturnValue(true)
    for (const fn of [
      listNotifications,
      countUnreadNotifications,
      markNotificationRead,
      markAllNotificationsRead,
    ]) {
      vi.mocked(fn).mockReset()
    }
  })

  const call = (method: string, path: string, cookie: string) =>
    app.request(`/api/notifications${path}`, { method, headers: { Cookie: cookie } })

  it('без сессии → 401', async () => {
    expect((await call('GET', '', '')).status).toBe(401)
    expect((await call('POST', '/read-all', '')).status).toBe(401)
    expect(vi.mocked(listNotifications)).not.toHaveBeenCalled()
  })

  it('лента своего аккаунта с курсором и счетчиком; pushBody наружу не уходит', async () => {
    vi.mocked(listNotifications).mockResolvedValue([row(9), row(8), row(7)])
    vi.mocked(countUnreadNotifications).mockResolvedValue(1)
    const res = await call('GET', '?limit=2&before=10', await employeeCookie())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(vi.mocked(listNotifications)).toHaveBeenCalledWith('u-emp', { limit: 2, before: 10 })
    expect(vi.mocked(countUnreadNotifications)).toHaveBeenCalledWith('u-emp')
    expect(body.hasMore).toBe(true)
    expect(body.unreadCount).toBe(1)
    expect(body.items.map((i: { id: number }) => i.id)).toEqual([9, 8])
    expect(body.items[0]).toEqual({
      id: 9,
      type: 'booking.assigned',
      title: 'Новая запись',
      body: '26.11, 10:00 · Иван · Kia Rio',
      link: '/bookings?booking=bk1',
      createdAt: '2026-11-25T08:00:00.000Z',
      readAt: null,
    })
  })

  it('без before берет первую страницу по умолчанию', async () => {
    vi.mocked(listNotifications).mockResolvedValue([])
    vi.mocked(countUnreadNotifications).mockResolvedValue(0)
    const body = await (await call('GET', '', await employeeCookie())).json()
    expect(vi.mocked(listNotifications)).toHaveBeenCalledWith('u-emp', {
      limit: 30,
      before: undefined,
    })
    expect(body).toEqual({ ok: true, items: [], hasMore: false, unreadCount: 0 })
  })

  it('кривой курсор → 400', async () => {
    expect((await call('GET', '?before=abc', await employeeCookie())).status).toBe(400)
    expect(vi.mocked(listNotifications)).not.toHaveBeenCalled()
  })

  it('unread-count считает только свои', async () => {
    vi.mocked(countUnreadNotifications).mockResolvedValue(3)
    const res = await call('GET', '/unread-count', await adminCookie())
    expect(await res.json()).toEqual({ ok: true, unreadCount: 3 })
    expect(vi.mocked(countUnreadNotifications)).toHaveBeenCalledWith('u-admin')
  })

  it('чужое или несуществующее уведомление → 404 (критерий 7)', async () => {
    vi.mocked(markNotificationRead).mockResolvedValue(false)
    const res = await call('POST', '/5/read', await employeeCookie())
    expect(res.status).toBe(404)
    expect(vi.mocked(markNotificationRead)).toHaveBeenCalledWith('u-emp', 5)
  })

  it('свое уведомление помечается прочитанным', async () => {
    vi.mocked(markNotificationRead).mockResolvedValue(true)
    const res = await call('POST', '/5/read', await employeeCookie())
    expect(await res.json()).toEqual({ ok: true })
  })

  it('read-all — только у вызывающего и не перехватывается /{id}/read (критерий 7)', async () => {
    vi.mocked(markAllNotificationsRead).mockResolvedValue()
    const res = await call('POST', '/read-all', await adminCookie())
    expect(res.status).toBe(200)
    expect(vi.mocked(markAllNotificationsRead)).toHaveBeenCalledWith('u-admin')
    expect(vi.mocked(markNotificationRead)).not.toHaveBeenCalled()
  })

  it.each([
    ['GET', ''],
    ['GET', '/unread-count'],
    ['POST', '/read-all'],
    ['POST', '/1/read'],
  ])('%s %s без базы → 503 (критерий 8)', async (method, path) => {
    vi.mocked(isDbReady).mockReturnValue(false)
    const res = await call(method, path, await employeeCookie())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('unavailable')
  })
})
