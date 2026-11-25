import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detachPushSubscription,
  hasPushIntent,
  isPushSubscribed,
  listenServiceWorkerMessages,
  subscribePush,
  syncPushSubscription,
  unsubscribePush,
} from '../src/lib/push'
import {
  deletePushSubscription,
  fetchPushSubscriptionStatus,
  savePushSubscription,
} from '../src/lib/notifications-api'

vi.mock('../src/lib/notifications-api', () => ({
  deletePushSubscription: vi.fn(),
  fetchPushConfig: vi.fn(),
  fetchPushSubscriptionStatus: vi.fn(),
  savePushSubscription: vi.fn(),
}))

const ENDPOINT = 'https://push.example/abc'
const LOGIN = 'emp1'
const INTENT = `push-intent:${LOGIN}`

function stubSubscription() {
  const unsubscribe = vi.fn().mockResolvedValue(true)
  const subscribe = vi.fn()
  const sub = {
    endpoint: ENDPOINT,
    unsubscribe,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
  }
  const registration = {
    pushManager: { getSubscription: async () => sub, subscribe },
  }
  vi.spyOn(navigator.serviceWorker, 'getRegistration').mockResolvedValue(registration as never)
  return { unsubscribe, subscribe }
}

const grant = (permission: NotificationPermission) =>
  vi.spyOn(Notification, 'permission', 'get').mockReturnValue(permission)

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(deletePushSubscription).mockReset()
  vi.mocked(savePushSubscription).mockReset()
  vi.mocked(fetchPushSubscriptionStatus).mockReset()
  localStorage.clear()
})

describe('detachPushSubscription', () => {
  it('удаляет подписку только на сервере, браузер и намерение не трогает', async () => {
    const { unsubscribe } = stubSubscription()
    localStorage.setItem(INTENT, '1')
    vi.mocked(deletePushSubscription).mockResolvedValue({ ok: true })
    await detachPushSubscription()
    expect(deletePushSubscription).toHaveBeenCalledWith(ENDPOINT)
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(hasPushIntent(LOGIN)).toBe(true)
  })
})

describe('subscribePush', () => {
  it('запоминает намерение аккаунта после сохранения на сервере', async () => {
    vi.spyOn(Notification, 'requestPermission').mockResolvedValue('granted')
    const sub = {
      endpoint: ENDPOINT,
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
    }
    vi.spyOn(navigator.serviceWorker, 'register').mockResolvedValue({} as never)
    vi.spyOn(navigator.serviceWorker, 'ready', 'get').mockReturnValue(
      Promise.resolve({ pushManager: { getSubscription: async () => sub } } as never),
    )
    vi.mocked(savePushSubscription).mockResolvedValue({ ok: true })
    expect(await subscribePush('AQID', LOGIN)).toBe('subscribed')
    expect(hasPushIntent(LOGIN)).toBe(true)
    expect(hasPushIntent('other')).toBe(false)
  })
})

describe('unsubscribePush', () => {
  it('удаляет подписку на сервере и в браузере и забывает намерение', async () => {
    const { unsubscribe } = stubSubscription()
    localStorage.setItem(INTENT, '1')
    vi.mocked(deletePushSubscription).mockResolvedValue({ ok: true })
    await unsubscribePush(LOGIN)
    expect(deletePushSubscription).toHaveBeenCalledWith(ENDPOINT)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(hasPushIntent(LOGIN)).toBe(false)
  })

  it('отписывает браузер, даже если сервер не узнал сессию', async () => {
    const { unsubscribe } = stubSubscription()
    vi.mocked(deletePushSubscription).mockResolvedValue({
      ok: false,
      error: 'unauthorized',
    } as never)
    await unsubscribePush(LOGIN)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('отписывает браузер, даже если запрос к серверу упал', async () => {
    const { unsubscribe } = stubSubscription()
    vi.mocked(deletePushSubscription).mockRejectedValue(new TypeError('Failed to fetch'))
    await unsubscribePush(LOGIN)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('без подписки в сервер не ходит', async () => {
    vi.spyOn(navigator.serviceWorker, 'getRegistration').mockResolvedValue(undefined)
    await unsubscribePush(LOGIN)
    expect(deletePushSubscription).not.toHaveBeenCalled()
  })
})

describe('syncPushSubscription', () => {
  it('пересохраняет существующую подписку, если разрешение дано и аккаунт ее включал', async () => {
    const { subscribe } = stubSubscription()
    grant('granted')
    localStorage.setItem(INTENT, '1')
    vi.mocked(savePushSubscription).mockResolvedValue({ ok: true })
    await syncPushSubscription(LOGIN)
    expect(savePushSubscription).toHaveBeenCalledExactlyOnceWith({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p', auth: 'a' },
    })
    expect(subscribe).not.toHaveBeenCalled()
  })

  it.each(['default', 'denied'] as const)(
    'при разрешении %s ничего не шлет',
    async (permission) => {
      stubSubscription()
      grant(permission)
      localStorage.setItem(INTENT, '1')
      await syncPushSubscription(LOGIN)
      expect(savePushSubscription).not.toHaveBeenCalled()
    },
  )

  it('без подписки в браузере не подписывает заново', async () => {
    const subscribe = vi.fn()
    vi.spyOn(navigator.serviceWorker, 'getRegistration').mockResolvedValue({
      pushManager: { getSubscription: async () => null, subscribe },
    } as never)
    grant('granted')
    localStorage.setItem(INTENT, '1')
    await syncPushSubscription(LOGIN)
    expect(subscribe).not.toHaveBeenCalled()
    expect(savePushSubscription).not.toHaveBeenCalled()
  })

  it('чужая подписка на общем телефоне не перевешивается на вошедшего', async () => {
    stubSubscription()
    grant('granted')
    localStorage.setItem('push-intent:someone-else', '1')
    await syncPushSubscription(LOGIN)
    expect(savePushSubscription).not.toHaveBeenCalled()
    expect(fetchPushSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('глотает ошибки сети и хранилища', async () => {
    stubSubscription()
    grant('granted')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    await expect(syncPushSubscription(LOGIN)).resolves.toBeUndefined()
    expect(savePushSubscription).not.toHaveBeenCalled()

    vi.mocked(Storage.prototype.getItem).mockReturnValue('1')
    vi.mocked(savePushSubscription).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(syncPushSubscription(LOGIN)).resolves.toBeUndefined()
  })

  it('статус подписки в профиле ждет пересохранения после входа', async () => {
    stubSubscription()
    grant('granted')
    localStorage.setItem(INTENT, '1')
    let saved = false
    let finish: () => void = () => {}
    vi.mocked(savePushSubscription).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            saved = true
            resolve({ ok: true })
          }
        }),
    )
    vi.mocked(fetchPushSubscriptionStatus).mockImplementation(async () => ({
      ok: true,
      subscribed: saved,
    }))
    void syncPushSubscription(LOGIN)
    const status = isPushSubscribed()
    await vi.waitFor(() => expect(savePushSubscription).toHaveBeenCalled())
    finish()
    expect(await status).toBe(true)
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
