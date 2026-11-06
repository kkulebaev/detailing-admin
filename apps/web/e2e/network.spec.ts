import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('recovers on its own when the connection drops during a page load', async ({ page }) => {
  await login(page, 'e2e-admin')
  const bookingsList = /\/api\/bookings\?/
  let attempts = 0
  page.on('request', (request) => {
    if (bookingsList.test(request.url())) attempts++
  })
  await page.route(bookingsList, (route) => route.abort('connectionreset'), { times: 1 })

  await page.goto('/bookings')

  await expect(page.getByRole('button', { name: /^С \d{2}\.\d{2}\.\d{4}$/ })).toBeVisible()
  await expect.poll(() => attempts).toBe(2)
  await expect(page.getByText('Не удалось загрузить')).toHaveCount(0)
})
