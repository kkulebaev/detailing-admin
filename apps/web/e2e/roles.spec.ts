import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('an employee lands on their hours and cannot reach the booking form or clients', async ({
  page,
}) => {
  await login(page, 'e2e-employee')
  await expect(page).toHaveURL(/\/employee$/)
  await expect(page.getByRole('heading', { name: 'Мои часы' })).toBeVisible()
  await expect(page.getByText('Мастер Пётр')).toBeVisible()

  await page.goto('/')
  await expect(page).toHaveURL(/\/employee$/)

  await page.goto('/clients')
  await expect(page).toHaveURL(/\/employee$/)
})

test('a booker gets the booking form but not the admin pages', async ({ page }) => {
  await login(page, 'e2e-booker')
  await expect(page.getByRole('heading', { name: 'Новая запись' })).toBeVisible()

  await page.goto('/clients')
  await expect(page).not.toHaveURL(/\/clients/)
  await expect(page.getByRole('heading', { name: 'Новая запись' })).toBeVisible()
})

test('an admin reaches the admin pages', async ({ page }) => {
  await login(page, 'e2e-admin')

  await page.goto('/salaries')
  await expect(page).toHaveURL(/\/salaries$/)
})
