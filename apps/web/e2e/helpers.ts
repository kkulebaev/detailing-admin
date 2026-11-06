import { expect, type Page } from '@playwright/test'

const API_URL = 'http://localhost:3100'

export const PASSWORD = 'e2e-password-123'

export async function login(page: Page, loginName: string) {
  await page.goto('/login')
  await page.getByLabel('Логин', { exact: true }).fill(loginName)
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

export interface FakesState {
  sheetRows: unknown[][]
  telegramMessages: { chat_id: string; text: string }[]
}

export async function fakesState(): Promise<FakesState> {
  const res = await fetch(`${API_URL}/__e2e/state`)
  return res.json()
}
