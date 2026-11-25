import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page, userEvent } from 'vitest/browser'
import type { Notification, NotificationsListResult } from '@/lib/notifications-api'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const api = vi.hoisted(() => ({
  fetchNotifications: vi.fn<(p?: { before?: number }) => Promise<NotificationsListResult>>(),
  markNotificationRead: vi.fn(),
  markNotificationUnread: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/notifications-api', () => ({
  fetchNotifications: api.fetchNotifications,
  markNotificationRead: api.markNotificationRead,
  markNotificationUnread: api.markNotificationUnread,
  markAllNotificationsRead: api.markAllNotificationsRead,
}))

vi.mock('@/lib/queries', () => ({
  useInvalidateNotifications: () => api.invalidate,
}))

vi.mock('vue-sonner', () => ({
  toast: { error: api.toastError, success: vi.fn() },
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
    api.markNotificationUnread.mockResolvedValue({ ok: true })
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

  const dialog = () => page.getByRole('dialog')

  it('тап открывает диалог с полным текстом и помечает прочитанным, без навигации', async () => {
    api.fetchNotifications.mockResolvedValue(
      ok([note(5, { body: 'Строка 1\nСтрока 2' })], false, 1),
    )
    const { router } = await mountPage()

    await page.getByRole('button', { name: /^Уведомление 5/ }).click()

    await expect.element(dialog().getByRole('heading', { name: 'Уведомление 5' })).toBeVisible()
    await expect.element(dialog().getByText(/Строка 1\s+Строка 2/)).toBeVisible()
    expect(document.querySelector('[role="dialog"] a')).toBeNull()
    expect(api.markNotificationRead).toHaveBeenCalledWith(5)
    await expect.poll(() => api.invalidate.mock.calls.length).toBe(1)
    await expect
      .element(page.getByRole('button', { name: 'Прочитать все' }))
      .not.toBeInTheDocument()
    expect(router.currentRoute.value.fullPath).toBe('/notifications')
  })

  it('повторное открытие прочитанного не шлет запрос', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(5, { readAt: '2026-11-25T09:00:00.000Z' })]))
    const { router } = await mountPage()

    await page.getByRole('button', { name: /^Уведомление 5/ }).click()
    await expect.element(dialog()).toBeVisible()
    await dialog().getByRole('button', { name: 'Close' }).click()
    await expect.element(dialog()).not.toBeInTheDocument()
    await page.getByRole('button', { name: /^Уведомление 5/ }).click()
    await expect.element(dialog()).toBeVisible()

    expect(api.markNotificationRead).not.toHaveBeenCalled()
    expect(api.markNotificationUnread).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/notifications')
  })

  const row = (id: number) => document.querySelector(`[data-notification-row="${id}"]`)!
  const swipedState = (id: number) => row(id).getAttribute('data-swiped')

  // Синтетические PointerEvent: настоящий тач в Browser Mode не воспроизвести.
  function swipe(id: number, dx: number, dy = 0) {
    const el = row(id).querySelector('[data-swipe-surface]')!
    const r = el.getBoundingClientRect()
    const x0 = r.left + r.width * 0.9
    const y0 = r.top + r.height / 2
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      )
    fire('pointerdown', x0, y0)
    for (let i = 1; i <= 5; i++) fire('pointermove', x0 + (dx * i) / 5, y0 + (dy * i) / 5)
    fire('pointerup', x0 + dx, y0 + dy)
  }

  const read = (id: number) => note(id, { readAt: '2026-11-25T09:00:00.000Z' })
  const action = (id: number) => row(id).querySelector<HTMLElement>('[data-swipe-action]')!

  it('свайп влево на 120px открывает «Не прочитано», тап по нему шлет /unread', async () => {
    api.fetchNotifications.mockResolvedValue(ok([read(5)]))
    const { router } = await mountPage()
    await expect.element(page.getByRole('button', { name: /^Уведомление 5/ })).toBeVisible()

    swipe(5, -120)
    await expect.poll(() => swipedState(5)).toBe('true')
    expect(action(5).textContent).toContain('Не прочитано')
    await userEvent.click(action(5))

    expect(api.markNotificationUnread).toHaveBeenCalledWith(5)
    await expect.poll(() => swipedState(5)).toBeNull()
    await expect
      .element(page.getByRole('button', { name: 'Отметить прочитанным: Уведомление 5' }))
      .toBeInTheDocument()
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.poll(() => api.invalidate.mock.calls.length).toBe(1)
    expect(router.currentRoute.value.fullPath).toBe('/notifications')
  })

  it('у непрочитанного действие «Прочитано» шлет /read', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(5)], false, 1))
    await mountPage()
    await expect.element(page.getByRole('button', { name: /^Уведомление 5/ })).toBeVisible()

    swipe(5, -120)
    await expect.poll(() => swipedState(5)).toBe('true')
    expect(action(5).textContent).toContain('Прочитано')
    await userEvent.click(action(5))

    expect(api.markNotificationRead).toHaveBeenCalledWith(5)
    await expect.element(dialog()).not.toBeInTheDocument()
  })

  it('полный свайп выполняет действие сразу', async () => {
    api.fetchNotifications.mockResolvedValue(ok([read(5)]))
    await mountPage()
    await expect.element(page.getByRole('button', { name: /^Уведомление 5/ })).toBeVisible()

    swipe(5, -row(5).getBoundingClientRect().width * 0.8)

    await expect.poll(() => api.markNotificationUnread.mock.calls.length).toBe(1)
    expect(swipedState(5)).toBeNull()
  })

  it('вертикальное смещение свайп не открывает', async () => {
    api.fetchNotifications.mockResolvedValue(ok([read(5)]))
    await mountPage()
    await expect.element(page.getByRole('button', { name: /^Уведомление 5/ })).toBeVisible()

    swipe(5, -6, 80)

    expect(swipedState(5)).toBeNull()
    expect(api.markNotificationUnread).not.toHaveBeenCalled()
  })

  it('тап по открытой строке закрывает свайп и диалог не открывает', async () => {
    api.fetchNotifications.mockResolvedValue(ok([read(5)]))
    await mountPage()
    await expect.element(page.getByRole('button', { name: /^Уведомление 5/ })).toBeVisible()
    swipe(5, -120)
    await expect.poll(() => swipedState(5)).toBe('true')

    await page.getByRole('button', { name: /^Уведомление 5/ }).click()

    await expect.poll(() => swipedState(5)).toBeNull()
    await expect.element(dialog()).not.toBeInTheDocument()
    expect(api.markNotificationUnread).not.toHaveBeenCalled()
  })

  it('открыт только один свайп; касание вне строки закрывает его', async () => {
    api.fetchNotifications.mockResolvedValue(ok([read(6), read(5)]))
    await mountPage()
    await expect.element(page.getByRole('button', { name: /^Уведомление 5/ })).toBeVisible()

    swipe(6, -120)
    await expect.poll(() => swipedState(6)).toBe('true')
    swipe(5, -120)
    await expect.poll(() => swipedState(5)).toBe('true')
    expect(swipedState(6)).toBeNull()

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await expect.poll(() => swipedState(5)).toBeNull()
  })

  it('скрытая кнопка-действие работает с клавиатуры, без вложенных button', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(6), read(5)], false, 1))
    await mountPage()
    await expect
      .element(page.getByRole('button', { name: 'Отметить прочитанным: Уведомление 6' }))
      .toBeInTheDocument()
    expect(document.querySelectorAll('button button')).toHaveLength(0)

    page.getByRole('button', { name: 'Отметить непрочитанным: Уведомление 5' }).element().focus()
    await userEvent.keyboard('{Enter}')

    expect(api.markNotificationUnread).toHaveBeenCalledWith(5)
    await expect
      .element(page.getByRole('button', { name: 'Отметить прочитанным: Уведомление 5' }))
      .toBeInTheDocument()
    await expect.element(dialog()).not.toBeInTheDocument()
  })

  it('в диалоге нет кнопок действий, только крестик', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(5)], false, 1))
    await mountPage()
    await page.getByRole('button', { name: /^Уведомление 5/ }).click()
    await expect.element(dialog()).toBeVisible()
    await expect
      .element(dialog().getByRole('button', { name: /Отметить непрочитанным/ }))
      .not.toBeInTheDocument()
    await expect.element(dialog().getByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('[role="dialog"] button')).toHaveLength(1)
  })

  it('сбой отметки прочитанным откатывает выделение и показывает тост', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(5)], false, 1))
    api.markNotificationRead.mockResolvedValue({ ok: false, error: 'not_found' })
    await mountPage()

    await page.getByRole('button', { name: /^Уведомление 5/ }).click()

    await expect.poll(() => api.toastError.mock.calls.length).toBe(1)
    await expect.element(page.getByText('Не прочитано')).toBeInTheDocument()
    // Пока открыт модальный диалог, страница под ним скрыта от ролей.
    await dialog().getByRole('button', { name: 'Close' }).click()
    await expect.element(page.getByRole('button', { name: 'Прочитать все' })).toBeVisible()
  })

  it('сетевая ошибка /unread откатывает к прочитанному', async () => {
    api.fetchNotifications.mockResolvedValue(ok([read(5)]))
    api.markNotificationUnread.mockRejectedValue(new Error('network'))
    await mountPage()
    await expect
      .element(page.getByRole('button', { name: 'Отметить непрочитанным: Уведомление 5' }))
      .toBeInTheDocument()

    page.getByRole('button', { name: 'Отметить непрочитанным: Уведомление 5' }).element().focus()
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => api.toastError.mock.calls.length).toBe(1)
    await expect
      .element(page.getByRole('button', { name: 'Отметить непрочитанным: Уведомление 5' }))
      .toBeInTheDocument()
  })

  it('«Прочитать все» снимает выделение со всех и обновляет счетчик', async () => {
    api.fetchNotifications.mockResolvedValue(ok([note(2), note(1)], false, 2))
    await mountPage()
    await expect
      .element(page.getByRole('button', { name: /^Отметить прочитанным/ }).first())
      .toBeInTheDocument()

    await page.getByRole('button', { name: 'Прочитать все' }).click()

    expect(api.markAllNotificationsRead).toHaveBeenCalledOnce()
    await expect
      .element(page.getByRole('button', { name: /^Отметить прочитанным/ }).first())
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Отметить непрочитанным: Уведомление 2' }))
      .toBeInTheDocument()
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

    await expect.element(page.getByRole('button', { name: /^Уведомление 7/ })).toBeVisible()
    expect(api.fetchNotifications).toHaveBeenLastCalledWith({ before: 8 })
    await expect.element(page.getByRole('button', { name: /^Уведомление 9/ })).toBeVisible()
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
