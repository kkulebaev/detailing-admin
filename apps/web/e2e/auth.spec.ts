import { expect, test } from '@playwright/test'
import { login, PASSWORD } from './helpers'

test('отклоняет неверный пароль и остается на странице входа', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Логин', { exact: true }).fill('e2e-admin')
  await page.getByLabel('Пароль', { exact: true }).fill(`${PASSWORD}-wrong`)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('после входа возвращает на запрошенную страницу', async ({ page }) => {
  await page.goto('/clients')
  await expect(page).toHaveURL(/\/login\?redirect=\/clients$/)

  await page.getByLabel('Логин', { exact: true }).fill('e2e-admin')
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/clients$/)
})

test('сохраняет сессию после перезагрузки и завершает ее при выходе', async ({ page }) => {
  await login(page, 'e2e-admin')
  await page.reload()
  await expect(page).not.toHaveURL(/\/login/)

  await page.getByRole('button', { name: 'Открыть меню' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})
