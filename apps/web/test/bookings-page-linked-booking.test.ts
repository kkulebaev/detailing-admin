import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import type { BookingMutationResponse } from '@detailing-admin/shared'
import type { BookingRow } from '@/lib/bookings-api'

const ID = '00000000-0000-4000-8000-000000000042'

const ROW: BookingRow = {
  id: ID,
  clientId: null,
  name: 'Клиент из ссылки',
  phone: '',
  car: 'Kia Rio',
  service: 'Полировка',
  note: '',
  dateFrom: '2025-01-15',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  readiness: '',
  master: [],
  responsible: '',
  carClass: 1,
  sheetRow: null,
  sheetRange: null,
  createdAt: '2025-01-01T10:00:00.000Z',
  createdBy: null,
}

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const net = vi.hoisted(() => ({
  booking: undefined as BookingMutationResponse | undefined,
  toastError: vi.fn(),
}))

// Список по фильтрам записи не содержит: она должна открыться мимо них.
vi.mock('@/lib/bookings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bookings-api')>()),
  fetchBookings: () => Promise.resolve({ ok: true, items: [], total: 0 }),
  fetchBooking: (id: string) =>
    Promise.resolve(net.booking ?? { ok: false, error: 'not_found', id }),
}))

vi.mock('@/lib/masters-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/masters-api')>()),
  fetchMasters: () => Promise.resolve({ ok: true, masters: [] }),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: net.toastError, success: vi.fn() },
}))

import BookingsPage from '@/components/BookingsPage.vue'
import { createTestRouter } from './helpers/router'

async function mountPage(path: string) {
  const router = await createTestRouter(path)
  mount(BookingsPage, {
    attachTo: document.body,
    global: { plugins: [createPinia(), PiniaColada, router] },
  })
  return router
}

enableAutoUnmount(afterEach)

describe('BookingsPage — ?booking=<id> из уведомления (6j)', () => {
  beforeEach(() => {
    net.booking = undefined
    net.toastError.mockReset()
  })

  it('открывает карточку записи, даже если фильтры ее не показывают', async () => {
    net.booking = { ok: true, booking: ROW }
    await mountPage(`/bookings?booking=${ID}`)
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByText('Клиент из ссылки')).toBeVisible()
  })

  it('закрытая карточка уходит из адреса', async () => {
    net.booking = { ok: true, booking: ROW }
    const router = await mountPage(`/bookings?booking=${ID}`)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => router.currentRoute.value.query.booking).toBeUndefined()
  })

  it('удаленная запись показывается тостом «Запись удалена»', async () => {
    const router = await mountPage(`/bookings?booking=${ID}`)
    await expect.poll(() => net.toastError.mock.calls).toEqual([['Запись удалена']])
    await expect.poll(() => router.currentRoute.value.query.booking).toBeUndefined()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })
})
