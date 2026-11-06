import { expect, test, type Page } from '@playwright/test'
import { fakesState, login } from './helpers'

const phoneField = (page: Page) => page.getByPlaceholder('+7 (___) ___-__-__')
const nameField = (page: Page) => page.getByLabel('Имя', { exact: true })

async function fillBooking(page: Page, client: { phone: string; name: string; car: string }) {
  await page.getByPlaceholder('ЧЧ:ММ').first().fill('10:00')
  await phoneField(page).fill(client.phone)
  await nameField(page).fill(client.name)
  await page.getByLabel('Марка и модель', { exact: true }).fill(client.car)
  await page.keyboard.press('Escape')

  // A combobox takes no accessible name from its content, so this one has none.
  await page.getByRole('combobox').filter({ hasText: 'Выбрать услугу' }).click()
  await page.getByRole('option', { name: /Полировка кузова/ }).click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Не выбрано' }).click()
  await page.getByRole('dialog').getByText('Мастер Пётр').click()
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: 'Ответственный' }).click()
  await page.getByRole('option', { name: 'Мастер Пётр' }).click()
}

test('saves a booking to the sheet and the mirror, and notifies the master', async ({ page }) => {
  await login(page, 'e2e-admin')
  await fillBooking(page, { phone: '9160000001', name: 'Анна', car: 'Kia Rio' })
  // Switches itself on once the chosen master has a Telegram id.
  await expect(page.getByRole('switch')).toBeChecked()

  await page.getByRole('button', { name: 'Сохранить запись' }).click()
  await expect(page.getByText('Запись сохранена')).toBeVisible()

  const { sheetRows, telegramMessages } = await fakesState()
  const row = sheetRows.find((r) => r[2] === 'Анна')
  expect(row).toBeDefined()
  expect(row?.[1]).toBe('10:00')
  expect(row?.[4]).toBe('Kia Rio')
  expect(row?.[5]).toContain('Полировка кузова')
  expect(row?.[9]).toBe('Мастер Пётр')
  expect(telegramMessages.some((m) => m.chat_id === '100' && m.text.includes('Анна'))).toBe(true)

  await page.goto('/bookings')
  await expect(page.getByText('Анна').first()).toBeVisible()
})

test('explains every missing field in Russian', async ({ page }) => {
  await login(page, 'e2e-admin')
  const rowsBefore = (await fakesState()).sheetRows.length

  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  await expect(page.getByText('Выберите ответственного')).toBeVisible()
  await expect(page.getByText(/Invalid input/)).toHaveCount(0)
  expect((await fakesState()).sheetRows).toHaveLength(rowsBefore)
})

test('recognises a returning client by phone', async ({ page }) => {
  await login(page, 'e2e-admin')
  await fillBooking(page, { phone: '9160000002', name: 'Борис', car: 'Lada Vesta' })
  await page.getByRole('button', { name: 'Сохранить запись' }).click()
  await expect(page.getByText('Запись сохранена')).toBeVisible()

  await page.reload()
  await phoneField(page).fill('9160000002')

  await expect(page.getByText('Найден клиент с именем: Борис')).toBeVisible()
  await expect(nameField(page)).toHaveValue('Борис')
})
