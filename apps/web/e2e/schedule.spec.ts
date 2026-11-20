import { expect, test, type Page } from '@playwright/test'
import { login } from './helpers'

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]
const GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

// Следующий месяц целиком в будущем, так что 15-е число всегда можно попросить.
const now = new Date()
const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
const nextMonthLabel = `${MONTHS[next.getUTCMonth()]} ${next.getUTCFullYear()}`
const day = `15 ${GENITIVE[next.getUTCMonth()]}`

async function openNextMonth(page: Page) {
  await page.goto('/schedule')
  await expect(page.getByRole('heading', { name: 'График' })).toBeVisible()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: nextMonthLabel }).click()
}

test('сотрудник просит рабочий день, админ одобряет, и день попадает в график', async ({
  page,
}) => {
  await login(page, 'e2e-employee')
  await openNextMonth(page)

  await page.getByRole('button', { name: `${day}: выходной` }).click()
  await page.getByRole('button', { name: 'Отправить на согласование' }).click()
  await expect(page.getByText('Заявка на согласовании')).toBeVisible()
  await expect(page.getByRole('img', { name: `${day}: рабочий` })).toBeVisible()

  await page.context().clearCookies()
  await login(page, 'e2e-admin')
  await page.goto('/schedule')
  await expect(page.getByText('Заявки на согласование: 1')).toBeVisible()
  await page.getByRole('button', { name: 'Одобрить заявку: Мастер Петр' }).click()
  await expect(page.getByText('Заявка одобрена, график обновлен')).toBeVisible()
  await expect(page.getByText('Заявки на согласование: 1')).toBeHidden()

  await openNextMonth(page)
  await page.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: 'Мастер Петр' }).click()
  await expect(page.getByRole('button', { name: `${day}: рабочий` })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.context().clearCookies()
  await login(page, 'e2e-employee')
  await page.goto('/schedule')
  await expect(page.getByText('Заявка одобрена')).toBeVisible()
})
