import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import type { BookingRow, BookingsListResponse } from '@/lib/bookings-api'

const ROW: BookingRow = {
  id: '00000000-0000-4000-8000-000000000001',
  clientId: null,
  name: 'Клиент',
  phone: '',
  car: 'Kia Rio',
  service: '',
  note: '',
  dateFrom: '2026-11-21',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  readiness: '',
  master: [],
  responsible: '',
  carClass: 1,
  sheetRow: null,
  sheetRange: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  createdBy: null,
}

// Настоящий useBookingsQuery (Pinia Colada с placeholderData), подменен только сетевой
// вызов: баг жил в том, как страница читает состояние запроса в полете.
const net = vi.hoisted(() => ({
  pending: [] as ((r: BookingsListResponse) => void)[],
}))

vi.mock('@/lib/bookings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bookings-api')>()),
  fetchBookings: () =>
    new Promise<BookingsListResponse>((resolve) => {
      net.pending.push(resolve)
    }),
}))

vi.mock('@/lib/masters-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/masters-api')>()),
  fetchMasters: () => Promise.resolve({ ok: true, masters: [] }),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import BookingsPage from '@/components/BookingsPage.vue'
import { createTestRouter } from './helpers/router'

async function mountPage(path: string) {
  const router = await createTestRouter(path)
  return mount(BookingsPage, {
    attachTo: document.body,
    global: {
      plugins: [createPinia(), PiniaColada, router],
      stubs: { BookingDetailsDialog: true, BookingEditDialog: true },
    },
  })
}

async function respond(items: BookingRow[]) {
  await expect.poll(() => net.pending.length).toBeGreaterThan(0)
  net.pending.shift()!({ ok: true, items, total: items.length })
}

// Через DOM, а не роли: открытая шторка фильтров прячет таблицу от поиска по ролям.
const header = () => document.querySelector('thead')

enableAutoUnmount(afterEach)

describe('BookingsPage — пустой результат, пока идет следующий запрос', () => {
  beforeEach(() => {
    net.pending = []
    localStorage.setItem('bookings:compact', 'false')
  })

  afterEach(() => {
    localStorage.removeItem('bookings:compact')
  })

  it('держит «Ничего не найдено» без шапки таблицы до ответа на новый фильтр', async () => {
    await mountPage(`/?period=all&readiness=${encodeURIComponent('Выдана')}`)
    await respond([])
    await expect.element(page.getByText('Ничего не найдено')).toBeVisible()

    await page.getByRole('button', { name: /^Фильтры/ }).click()
    await page.getByRole('button', { name: 'Готовность' }).click()
    await page.getByRole('checkbox', { name: 'Отмена' }).click()

    await expect.poll(() => net.pending.length).toBe(1)
    expect(header()).toBeNull()
    expect(document.body.textContent).toContain('Ничего не найдено')

    await respond([ROW])
    await expect.poll(header).not.toBeNull()
    expect(document.body.textContent).not.toContain('Ничего не найдено')
  })

  it('не подменяет текст пустого состояния, пока сброс фильтров ждет ответа', async () => {
    await mountPage(`/?period=all&readiness=${encodeURIComponent('Выдана')}`)
    await respond([])
    await expect.element(page.getByText('Ничего не найдено')).toBeVisible()

    await page.getByRole('button', { name: 'Сбросить фильтры' }).click()

    await expect.poll(() => net.pending.length).toBe(1)
    await expect.element(page.getByText('Ничего не найдено')).toBeInTheDocument()
    expect(page.getByText(/Записей пока нет|Нет записей с сегодняшнего дня/).query()).toBeNull()

    await respond([ROW])
    await expect.element(page.getByText('Ничего не найдено')).not.toBeInTheDocument()
  })
})
