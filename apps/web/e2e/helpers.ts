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
  pushMessages: { endpoint: string; payload: unknown }[]
}

export async function fakesState(): Promise<FakesState> {
  const res = await fetch(`${API_URL}/__e2e/state`)
  return res.json()
}

/** Сообщение пользователя боту; ответ бота окажется в telegramMessages. */
export async function telegramUpdate(chatId: number, text: string): Promise<void> {
  const res = await fetch(`${API_URL}/__e2e/telegram/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, text }),
  })
  if (!res.ok) throw new Error(`telegram update failed: ${res.status}`)
}
