import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import NotificationSettingsCard from '../src/components/NotificationSettingsCard.vue'
import {
  fetchPushPublicKey,
  isPushSubscribed,
  notificationPermission,
  pushSupport,
  subscribePush,
  unsubscribePush,
} from '../src/lib/push'

vi.mock('../src/lib/push', () => ({
  fetchPushPublicKey: vi.fn(),
  isPushSubscribed: vi.fn(),
  notificationPermission: vi.fn(),
  pushSupport: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const toggle = () => page.getByRole('switch', { name: 'Пуши на этом устройстве' })

enableAutoUnmount(afterEach)

describe('NotificationSettingsCard', () => {
  beforeEach(() => {
    vi.mocked(fetchPushPublicKey).mockReset().mockResolvedValue('BPublic')
    vi.mocked(isPushSubscribed).mockReset().mockResolvedValue(false)
    vi.mocked(notificationPermission).mockReset().mockReturnValue('default')
    vi.mocked(pushSupport).mockReset().mockReturnValue('supported')
    vi.mocked(subscribePush).mockReset()
    vi.mocked(unsubscribePush).mockReset().mockResolvedValue()
  })

  const mountCard = () => mount(NotificationSettingsCard, { attachTo: document.body })

  it('без VAPID сообщает, что пуши не настроены, и переключателя нет (критерий 9)', async () => {
    vi.mocked(fetchPushPublicKey).mockResolvedValue(null)
    mountCard()
    await expect.element(page.getByText('Пуши пока не настроены на сервере.')).toBeVisible()
    await expect.element(toggle()).not.toBeInTheDocument()
  })

  it('на iOS вне экрана «Домой» вместо переключателя подсказка', async () => {
    vi.mocked(pushSupport).mockReturnValue('ios-needs-install')
    mountCard()
    await expect.element(page.getByText(/Добавьте приложение на экран „Домой“/)).toBeVisible()
    await expect.element(toggle()).not.toBeInTheDocument()
  })

  it('при запрете уведомлений объясняет, как разрешить', async () => {
    vi.mocked(notificationPermission).mockReturnValue('denied')
    mountCard()
    await expect.element(page.getByText(/Уведомления для этого сайта запрещены/)).toBeVisible()
    await expect.element(toggle()).not.toBeInTheDocument()
  })

  it('состояние сверяется с сервером', async () => {
    vi.mocked(isPushSubscribed).mockResolvedValue(true)
    mountCard()
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('включение подписывает по тапу', async () => {
    vi.mocked(subscribePush).mockResolvedValue('subscribed')
    mountCard()
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
    await toggle().click()
    expect(subscribePush).toHaveBeenCalledWith('BPublic')
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('если в разрешении отказали, показывает подсказку вместо переключателя', async () => {
    vi.mocked(subscribePush).mockImplementation(async () => {
      vi.mocked(notificationPermission).mockReturnValue('denied')
      return 'denied'
    })
    mountCard()
    await toggle().click()
    await expect.element(page.getByText(/Уведомления для этого сайта запрещены/)).toBeVisible()
  })

  it('сбой подписки оставляет переключатель выключенным', async () => {
    vi.mocked(subscribePush).mockResolvedValue('error')
    mountCard()
    await toggle().click()
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  })

  it('выключение отписывает устройство', async () => {
    vi.mocked(isPushSubscribed).mockResolvedValue(true)
    mountCard()
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true')
    await toggle().click()
    expect(unsubscribePush).toHaveBeenCalledOnce()
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'false')
  })
})
