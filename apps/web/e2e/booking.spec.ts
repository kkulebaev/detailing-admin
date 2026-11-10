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

  await page.getByRole('combobox', { name: 'Услуга: Выбрать услугу' }).click()
  await page.getByRole('option', { name: /Полировка кузова/ }).click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Не выбрано' }).click()
  await page.getByRole('dialog').getByText('Мастер Петр').click()
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: 'Ответственный' }).click()
  await page.getByRole('option', { name: 'Мастер Петр' }).click()
}

test('сохраняет запись в таблицу и зеркало и уведомляет мастера', async ({ page }) => {
  await login(page, 'e2e-admin')
  await fillBooking(page, { phone: '9160000001', name: 'Анна', car: 'Kia Rio' })
  // Включается сам, если у выбранного мастера есть Telegram id.
  await expect(page.getByRole('switch')).toBeChecked()

  await page.getByRole('button', { name: 'Сохранить запись' }).click()
  await expect(page.getByText('Запись сохранена')).toBeVisible()

  const { sheetRows, telegramMessages } = await fakesState()
  const row = sheetRows.find((r) => r[2] === 'Анна')
  expect(row).toBeDefined()
  expect(row?.[1]).toBe('10:00')
  expect(row?.[4]).toBe('Kia Rio')
  expect(row?.[5]).toContain('Полировка кузова')
  expect(row?.[9]).toBe('Мастер Петр')
  expect(telegramMessages.some((m) => m.chat_id === '100' && m.text.includes('Анна'))).toBe(true)

  await page.goto('/bookings')
  await expect(page.getByText('Анна').first()).toBeVisible()
})

test('поясняет каждое незаполненное поле по-русски', async ({ page }) => {
  await login(page, 'e2e-admin')
  const rowsBefore = (await fakesState()).sheetRows.length

  await page.getByRole('button', { name: 'Сохранить запись' }).click()

  await expect(page.getByText('Выберите ответственного')).toBeVisible()
  await expect(page.getByText(/Invalid input/)).toHaveCount(0)
  expect((await fakesState()).sheetRows).toHaveLength(rowsBefore)
})

test('узнает вернувшегося клиента по телефону', async ({ page }) => {
  await login(page, 'e2e-admin')
  await fillBooking(page, { phone: '9160000002', name: 'Борис', car: 'Lada Vesta' })
  await page.getByRole('button', { name: 'Сохранить запись' }).click()
  await expect(page.getByText('Запись сохранена')).toBeVisible()

  await page.reload()
  await phoneField(page).fill('9160000002')

  await expect(page.getByText('Найден клиент с именем: Борис')).toBeVisible()
  await expect(nameField(page)).toHaveValue('Борис')
})

test('удаленная запись возвращается из корзины, а история это помнит', async ({ page }) => {
  await login(page, 'e2e-admin')
  await fillBooking(page, { phone: '9160000003', name: 'Галина', car: 'Skoda Octavia' })
  await page.getByRole('button', { name: 'Сохранить запись' }).click()
  await expect(page.getByText('Запись сохранена')).toBeVisible()

  await page.goto('/bookings')
  await page.getByRole('button', { name: 'Удалить запись Галина' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Запись удалена')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить запись Галина' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Удаленные' }).click()
  const trash = page.getByRole('dialog', { name: 'Удаленные записи' })
  await expect(trash.getByText('Skoda Octavia')).toBeVisible()
  await trash.getByRole('button', { name: 'Восстановить' }).click()
  await expect(page.getByText('Запись восстановлена')).toBeVisible()
  await expect(trash.getByText('Удаленных записей нет')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByLabel('Компактный режим').first().check()
  await page.getByText('Галина').first().click()
  await page.getByRole('button', { name: 'История изменений' }).click()
  const details = page.getByRole('dialog', { name: 'Skoda Octavia' })
  await expect(details.getByText('Создал(а) запись')).toBeVisible()
  await expect(details.getByText('Удалил(а) запись')).toBeVisible()
  await expect(details.getByText('Восстановил(а) запись')).toBeVisible()
})
