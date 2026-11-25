import { expect, request, test, type Page } from '@playwright/test'
import { PASSWORD, fakesState, login } from './helpers'

// Настоящий PushManager в headless Chromium подписаться не может (у него нет
// push-сервиса), а разрешение на уведомления там всегда denied, даже после
// grantPermissions, поэтому браузерная часть подменена: подписка живет в localStorage, как
// живет в профиле браузера настоящая, и переживает выход и перезагрузку. Все остальное
// настоящее: воркер, разрешение, API, база и доставка до фейкового отправителя.
async function fakePushManager(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' })
    Notification.requestPermission = async () => 'granted'
    const KEY = 'e2e-push-subscription'
    type Data = { endpoint: string; key: number[] }
    const make = (data: Data) => ({
      endpoint: data.endpoint,
      options: { applicationServerKey: new Uint8Array(data.key).buffer, userVisibleOnly: true },
      toJSON: () => ({ endpoint: data.endpoint, keys: { p256dh: 'e2e-p256dh', auth: 'e2e-auth' } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY)
        return true
      },
    })
    PushManager.prototype.getSubscription = async function () {
      const raw = localStorage.getItem(KEY)
      return raw ? (make(JSON.parse(raw) as Data) as unknown as PushSubscription) : null
    }
    PushManager.prototype.subscribe = async function (options) {
      localStorage.setItem(
        'e2e-subscribe-calls',
        String(Number(localStorage.getItem('e2e-subscribe-calls') ?? 0) + 1),
      )
      const key = options?.applicationServerKey as Uint8Array
      const data = {
        endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`,
        key: Array.from(key),
      }
      localStorage.setItem(KEY, JSON.stringify(data))
      return make(data) as unknown as PushSubscription
    }
  })
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Открыть меню' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login/)
}

test('пуши переживают выход и вход на том же телефоне и не приходят после выхода', async ({
  page,
  baseURL,
}) => {
  await fakePushManager(page)

  const admin = await request.newContext({ baseURL })
  const signedIn = await admin.post('/api/auth/login', {
    data: { login: 'e2e-admin', password: PASSWORD },
  })
  expect(signedIn.ok()).toBe(true)
  const masters = await (await admin.get('/api/masters')).json()
  const master = masters.masters.find((m: { name: string }) => m.name === 'Мастер Петр')
  const payout = async (amount: number) => {
    const res = await admin.post('/api/salaries/payouts', {
      data: { masterId: master.id, payoutDate: '2026-11-21', amount },
    })
    expect(res.status()).toBe(201)
  }

  await login(page, 'e2e-employee')
  await page.goto('/profile')
  const toggle = page.getByRole('switch', { name: 'На этом устройстве' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  const endpoint = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('e2e-push-subscription')!) as { endpoint: string }).endpoint,
  )
  const pushes = async () =>
    (await fakesState()).pushMessages.filter((m) => m.endpoint === endpoint)

  await payout(1100)
  await expect.poll(async () => (await pushes()).length).toBe(1)

  await logout(page)
  // Браузерная подписка и намерение аккаунта остались: вернуть их можно без жеста.
  expect(await page.evaluate(() => localStorage.getItem('e2e-push-subscription'))).not.toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('push-intent:e2e-employee'))).toBe('1')

  await payout(1200)
  // Доставка идет сразу после коммита; дольше ждать нечего.
  await page.waitForTimeout(1500)
  expect(await pushes()).toHaveLength(1)

  // Другой человек на этом же телефоне подписку себе не получает.
  await login(page, 'e2e-admin')
  const status = await page.request.post('/api/notifications/push/subscriptions/current', {
    data: { endpoint },
  })
  expect(await status.json()).toEqual({ ok: true, subscribed: false })
  await logout(page)

  await login(page, 'e2e-employee')
  await page.goto('/profile')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await payout(1300)
  await expect.poll(async () => (await pushes()).length).toBe(2)
  expect(await page.evaluate(() => localStorage.getItem('e2e-subscribe-calls'))).toBe('1')

  // Выключение в профиле отписывает браузер и забывает намерение.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => localStorage.getItem('e2e-push-subscription'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('push-intent:e2e-employee'))).toBeNull()

  await admin.dispose()
})
