import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenServiceWorkerMessages, unsubscribePush } from '../src/lib/push'
import { deletePushSubscription } from '../src/lib/notifications-api'

vi.mock('../src/lib/notifications-api', () => ({
  deletePushSubscription: vi.fn(),
  fetchPushConfig: vi.fn(),
  fetchPushSubscriptionStatus: vi.fn(),
  savePushSubscription: vi.fn(),
}))

function stubSubscription() {
  const unsubscribe = vi.fn().mockResolvedValue(true)
  const registration = {
    pushManager: {
      getSubscription: async () => ({ endpoint: 'https://push.example/abc', unsubscribe }),
    },
  }
  vi.spyOn(navigator.serviceWorker, 'getRegistration').mockResolvedValue(registration as never)
  return unsubscribe
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(deletePushSubscription).mockReset()
})

describe('unsubscribePush', () => {
  it('удаляет подписку на сервере и в браузере', async () => {
    const unsubscribe = stubSubscription()
    vi.mocked(deletePushSubscription).mockResolvedValue({ ok: true })
    await unsubscribePush()
    expect(deletePushSubscription).toHaveBeenCalledWith('https://push.example/abc')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('отписывает браузер, даже если сервер не узнал сессию', async () => {
    const unsubscribe = stubSubscription()
    vi.mocked(deletePushSubscription).mockResolvedValue({
      ok: false,
      error: 'unauthorized',
    } as never)
    await unsubscribePush()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('отписывает браузер, даже если запрос к серверу упал', async () => {
    const unsubscribe = stubSubscription()
    vi.mocked(deletePushSubscription).mockRejectedValue(new TypeError('Failed to fetch'))
    await unsubscribePush()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('без подписки в сервер не ходит', async () => {
    vi.spyOn(navigator.serviceWorker, 'getRegistration').mockResolvedValue(undefined)
    await unsubscribePush()
    expect(deletePushSubscription).not.toHaveBeenCalled()
  })
})

describe('listenServiceWorkerMessages', () => {
  const post = (data: unknown) =>
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data }))

  it('переходит по безопасной ссылке и обновляет счетчик', () => {
    const navigate = vi.fn()
    const notification = vi.fn()
    const stop = listenServiceWorkerMessages({ navigate, notification })
    post({ type: 'navigate', link: '/bookings?booking=bk1' })
    post({ type: 'notification' })
    stop()
    post({ type: 'navigate', link: '/schedule' })
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/bookings?booking=bk1')
    expect(notification).toHaveBeenCalledTimes(2)
  })

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com'])('не уходит на %s', (link) => {
    const navigate = vi.fn()
    const stop = listenServiceWorkerMessages({ navigate, notification: vi.fn() })
    post({ type: 'navigate', link })
    stop()
    expect(navigate).not.toHaveBeenCalled()
  })
})
