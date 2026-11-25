import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('сам восстанавливается, если соединение обрывается при загрузке страницы', async ({
  page,
}) => {
  await login(page, 'e2e-admin')
  const bookingsList = /\/api\/bookings\?/
  let attempts = 0
  page.on('request', (request) => {
    if (bookingsList.test(request.url())) attempts++
  })
  await page.route(bookingsList, (route) => route.abort('connectionreset'), { times: 1 })

  await page.goto('/bookings')

  // По умолчанию /bookings открывается на текущем месяце, например «Ноябрь 2026».
  const now = new Date()
  const month = now.toLocaleString('ru-RU', { month: 'long' })
  const currentMonth = `${month[0]!.toUpperCase()}${month.slice(1)} ${now.getFullYear()}`
  await expect(page.getByRole('button', { name: currentMonth, exact: true })).toBeVisible()
  await expect.poll(() => attempts).toBe(2)
  await expect(page.getByText('Не удалось загрузить')).toHaveCount(0)
})
