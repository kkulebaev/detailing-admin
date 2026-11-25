import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { Notification, NotificationsListResult } from '@/lib/notifications-api'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const api = vi.hoisted(() => ({
  fetchNotifications: vi.fn<(p?: { before?: number }) => Promise<NotificationsListResult>>(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/notifications-api', () => ({
  fetchNotifications: api.fetchNotifications,
  markNotificationRead: api.markNotificationRead,
  markAllNotificationsRead: api.markAllNotificationsRead,
}))

vi.mock('@/lib/queries', () => ({
  useInvalidateNotifications: () => api.invalidate,
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import NotificationsPage from '@/pages/NotificationsPage.vue'
import { createTestRouter } from './helpers/router'

const note = (id: number, over: Partial<Notification> = {}): Notification => ({
  id,
  type: 'booking.assigned',
  title: `Уведомление ${id}`,
  body: `Текст ${id}`,
  link: '/bookings?booking=00000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-25T08:00:00.000Z',
  readAt: null,
  ...over,
})

const ok = (items: Notification[], hasMore = false, unreadCount = 0): NotificationsListResult => ({
  ok: true,
  items,
  hasMore,
  unreadCount,
})

async function mountPage() {
  const router = await createTestRouter('/notifications')
  const wrapper = mount(NotificationsPage, {
    attachTo: document.body,
    global: { plugins: [router] },
  })
  return { wrapper, router }
}

enableAutoUnmount(afterEach)

describe('NotificationsPage', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
    api.markNotificationRead.mockResolvedValue({ ok: true })
    api.markAllNotificationsRead.mockResolvedValue({ ok: true })
  })

  it('пустая лента показывает пустое состояние', async () => {
    api.fetchNotifications.mockResolvedValue(ok([]))
    await mountPage()
    await expect.element(page.getByText('Уведомлений нет')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Прочитать все' }))
      .not.toBeInTheDocument()
  })

  it('тап по уведомлению помечает его прочитанным и открывает ссылку', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(5)], false, 1))
    const { router } = await mountPage()

    await page.getByRole('button', { name: /Уведомление 5/ }).click()

    await expect
      .poll(() => router.currentRoute.value.fullPath)
      .toBe('/bookings?booking=00000000-0000-4000-8000-000000000001')
    expect(api.markNotificationRead).toHaveBeenCalledWith(5)
    await expect.poll(() => api.invalidate.mock.calls.length).toBe(1)
  })

  it('прочитанное уведомление повторно не отмечается', async () => {
    api.fetchNotifications.mockResolvedValue(
      ok([note(5, { readAt: '2026-11-25T09:00:00.000Z', link: '/schedule' })]),
    )
    const { router } = await mountPage()
    await page.getByRole('button', { name: /Уведомление 5/ }).click()
    await expect.poll(() => router.currentRoute.value.fullPath).toBe('/schedule')
    expect(api.markNotificationRead).not.toHaveBeenCalled()
  })

  it('«Прочитать все» снимает выделение со всех и обновляет счетчик', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(2), note(1)], false, 2))
    await mountPage()
    await expect.element(page.getByText('Не прочитано').first()).toBeInTheDocument()

    await page.getByRole('button', { name: 'Прочитать все' }).click()

    expect(api.markAllNotificationsRead).toHaveBeenCalledOnce()
    await expect.element(page.getByText('Не прочитано').first()).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Прочитать все' }))
      .not.toBeInTheDocument()
    expect(api.invalidate).toHaveBeenCalled()
  })

  it('«Показать еще» догружает по курсору последнего id', async () => {
    api.fetchNotifications
      .mockResolvedValueOnce(ok([note(9), note(8)], true))
      .mockResolvedValueOnce(ok([note(7)], false))
    await mountPage()

    await page.getByRole('button', { name: 'Показать еще' }).click()

    await expect.element(page.getByRole('button', { name: /Уведомление 7/ })).toBeVisible()
    expect(api.fetchNotifications).toHaveBeenLastCalledWith({ before: 8 })
    await expect.element(page.getByRole('button', { name: /Уведомление 9/ })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Показать еще' })).not.toBeInTheDocument()
  })

  it('ошибка базы показывается вместо ленты', async () => {
    api.fetchNotifications.mockResolvedValue({
      ok: false,
      error: 'unavailable',
      message: 'База на обслуживании',
    })
    await mountPage()
    await expect.element(page.getByText('База на обслуживании')).toBeVisible()
    await expect.element(page.getByText('Уведомлений нет')).not.toBeInTheDocument()
  })
})
