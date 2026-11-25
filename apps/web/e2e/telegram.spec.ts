import { expect, test } from '@playwright/test'
import { fakesState, login, telegramUpdate } from './helpers'

const CHAT = 900001

const repliesTo = async (chatId: number) =>
  (await fakesState()).telegramMessages
    .filter((m) => String(m.chat_id) === String(chatId))
    .map((m) => m.text)

test('сотрудник подключает Telegram в профиле, и деньги и записи приходят в чат', async ({
  page,
}) => {
  // Настоящий t.me не нужен: из ссылки берется только токен.
  await page
    .context()
    .route('https://t.me/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
    )
  await login(page, 'e2e-employee')
  await page.goto('/profile')

  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Подключить' }).click()
  const popup = await popupPromise
  await popup.waitForURL(/^https:\/\/t\.me\/dazzle_e2e_bot\?start=/)
  const token = new URL(popup.url()).searchParams.get('start')
  expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  await popup.close()

  await telegramUpdate(CHAT, `/start ${token}`)
  expect(await repliesTo(CHAT)).toEqual(['Уведомления подключены'])
  // Повтор того же апдейта: токен уже погашен, но чат привязан.
  await telegramUpdate(CHAT, `/start ${token}`)
  expect((await repliesTo(CHAT)).at(-1)).toBe('Уже подключено')
  // Тот же токен из чужого чата больше не работает.
  await telegramUpdate(CHAT + 1, `/start ${token}`)
  expect(await repliesTo(CHAT + 1)).toEqual(['Ссылка устарела, создайте новую в профиле'])

  // Вернулись из Telegram на вкладку — статус перечитан.
  await page.bringToFront()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('Подключено', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отключить' })).toBeVisible()

  await page.context().clearCookies()
  await login(page, 'e2e-admin')
  const masters = await (await page.request.get('/api/masters')).json()
  const master = masters.masters.find((m: { name: string }) => m.name === 'Мастер Петр')
  const payout = await page.request.post('/api/salaries/payouts', {
    data: { masterId: master.id, payoutDate: '2026-11-20', amount: 1500 },
  })
  expect(payout.status()).toBe(201)

  await expect
    .poll(async () => (await repliesTo(CHAT)).find((t) => t.startsWith('<b>Новая выплата</b>')))
    .toBeDefined()
  const message = (await repliesTo(CHAT)).find((t) => t.startsWith('<b>Новая выплата</b>'))!
  // Из уведомлений никуда не переходят: ни ссылки, ни адреса приложения в тексте.
  expect(message).not.toMatch(/<a\b|href=|https?:\/\//)
  expect(message.split('\n')).toHaveLength(2)

  // Старые закэшированные клиенты еще шлют notify: поле молча отбрасывается.
  const booking = await page.request.post('/api/bookings', {
    headers: { 'Idempotency-Key': 'e2e-telegram-booking' },
    data: {
      dateFrom: '26.11.2026',
      time: '10:00',
      name: 'Зинаида',
      phone: '+79160000099',
      car: 'Kia Sorento',
      service: 'Полировка кузова',
      amount: 6000,
      master: ['Мастер Петр'],
      responsible: 'Мастер Петр',
      carClass: 2,
      notify: true,
    },
  })
  expect(booking.status()).toBe(201)
  expect(await booking.json()).not.toHaveProperty('notification')

  const bookingMessage = () =>
    repliesTo(CHAT).then((all) => all.find((t) => t.startsWith('<b>У вас новая запись</b>')))
  await expect.poll(bookingMessage).toBeDefined()
  const text = (await bookingMessage())!
  expect(text).toContain('Kia Sorento')
  expect(text).toContain('Полировка кузова')
  // Текст пуша: без имени и телефона клиента.
  expect(text).not.toContain('Зинаида')
  expect(text).not.toContain('9160000099')
  const { telegramMessages } = await fakesState()
  expect(telegramMessages.filter((m) => m.text.includes('Kia Sorento'))).toHaveLength(1)
  expect(telegramMessages.some((m) => m.text.includes('Зинаида'))).toBe(false)

  await page.context().clearCookies()
  await login(page, 'e2e-employee')
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Отключить' }).click()
  await expect(page.getByRole('button', { name: 'Подключить' })).toBeVisible()
})
