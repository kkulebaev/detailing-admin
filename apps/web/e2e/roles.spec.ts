import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('сотрудник попадает на свои часы и не может открыть форму записи или клиентов', async ({
  page,
}) => {
  await login(page, 'e2e-employee')
  await expect(page).toHaveURL(/\/employee$/)
  await expect(page.getByRole('heading', { name: 'Мои часы' })).toBeVisible()
  await expect(page.getByText('Мастер Петр')).toBeVisible()

  await page.goto('/')
  await expect(page).toHaveURL(/\/employee$/)

  await page.goto('/clients')
  await expect(page).toHaveURL(/\/employee$/)
})

test('букеру доступна форма записи, но не страницы админа', async ({ page }) => {
  await login(page, 'e2e-booker')
  await expect(page.getByRole('heading', { name: 'Новая запись' })).toBeVisible()

  await page.goto('/clients')
  await expect(page).not.toHaveURL(/\/clients/)
  await expect(page.getByRole('heading', { name: 'Новая запись' })).toBeVisible()
})

test('админ открывает страницы админа', async ({ page }) => {
  await login(page, 'e2e-admin')

  await page.goto('/salaries')
  await expect(page).toHaveURL(/\/salaries$/)
})
