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
import {
  createTelegramLink,
  fetchTelegramStatus,
  unlinkTelegram,
} from '../src/lib/notifications-api'
import { toast } from 'vue-sonner'

vi.mock('../src/lib/push', () => ({
  fetchPushPublicKey: vi.fn(),
  isPushSubscribed: vi.fn(),
  notificationPermission: vi.fn(),
  pushSupport: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}))
vi.mock('../src/lib/notifications-api', () => ({
  fetchTelegramStatus: vi.fn(),
  createTelegramLink: vi.fn(),
  unlinkTelegram: vi.fn(),
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
    vi.mocked(fetchTelegramStatus)
      .mockReset()
      .mockResolvedValue({ ok: true, connected: false, botAvailable: true })
    vi.mocked(createTelegramLink).mockReset()
    vi.mocked(unlinkTelegram).mockReset().mockResolvedValue({ ok: true })
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

describe('NotificationSettingsCard — Telegram', () => {
  const connect = () => page.getByRole('button', { name: 'Подключить' })
  const disconnect = () => page.getByRole('button', { name: 'Отключить' })

  beforeEach(() => {
    vi.mocked(fetchPushPublicKey).mockReset().mockResolvedValue(null)
    vi.mocked(fetchTelegramStatus)
      .mockReset()
      .mockResolvedValue({ ok: true, connected: false, botAvailable: true })
    vi.mocked(createTelegramLink).mockReset()
    vi.mocked(unlinkTelegram).mockReset().mockResolvedValue({ ok: true })
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mountCard = () => mount(NotificationSettingsCard, { attachTo: document.body })

  function fakeWindow() {
    const win = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    return { win, open }
  }

  it('не подключено: «Подключить» открывает ссылку на бота в новом окне', async () => {
    const { win, open } = fakeWindow()
    let resolve: (v: { ok: true; url: string }) => void = () => {}
    vi.mocked(createTelegramLink).mockReturnValue(new Promise((r) => (resolve = r)))
    mountCard()
    await connect().click()
    // Окно открыто до ответа сервера: иначе iOS сочтет его всплывающим и заблокирует.
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(win.location.href).toBe('')
    resolve({ ok: true, url: 'https://t.me/dazzle_bot?start=tok' })
    await vi.waitFor(() => expect(win.location.href).toBe('https://t.me/dazzle_bot?start=tok'))
    expect(win.opener).toBeNull()
  })

  it('сбой ссылки закрывает пустое окно и сообщает об ошибке', async () => {
    const { win } = fakeWindow()
    vi.mocked(createTelegramLink).mockResolvedValue({ ok: false, error: 'internal' })
    mountCard()
    await connect().click()
    await vi.waitFor(() => expect(win.close).toHaveBeenCalledOnce())
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('подключено: «Подключено» и «Отключить»', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue({
      ok: true,
      connected: true,
      botAvailable: true,
    })
    mountCard()
    await expect.element(page.getByText('Подключено', { exact: true })).toBeVisible()
    vi.mocked(fetchTelegramStatus).mockResolvedValue({
      ok: true,
      connected: false,
      botAvailable: true,
    })
    await disconnect().click()
    expect(unlinkTelegram).toHaveBeenCalledOnce()
    await expect.element(connect()).toBeVisible()
    await expect.element(page.getByText('Подключено', { exact: true })).not.toBeInTheDocument()
  })

  it('бот недоступен: «Telegram недоступен» и без кнопок', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue({
      ok: true,
      connected: false,
      botAvailable: false,
    })
    mountCard()
    await expect.element(page.getByText('Telegram недоступен')).toBeVisible()
    await expect.element(connect()).not.toBeInTheDocument()
    await expect.element(disconnect()).not.toBeInTheDocument()
  })

  it('без базы тоже «недоступен»', async () => {
    vi.mocked(fetchTelegramStatus).mockResolvedValue({
      ok: false,
      error: 'unavailable',
      message: 'db',
    })
    mountCard()
    await expect.element(page.getByText('Telegram недоступен')).toBeVisible()
  })

  it.each([
    ['focus', () => window.dispatchEvent(new Event('focus'))],
    ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('перечитывает статус после возврата на вкладку (%s)', async (_name, fire) => {
    mountCard()
    await expect.element(connect()).toBeVisible()
    vi.mocked(fetchTelegramStatus).mockResolvedValue({
      ok: true,
      connected: true,
      botAvailable: true,
    })
    fire()
    await expect.element(page.getByText('Подключено', { exact: true })).toBeVisible()
    expect(fetchTelegramStatus).toHaveBeenCalledTimes(2)
  })
})
