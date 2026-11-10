import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createPinia } from 'pinia'
import type { ComputedRef } from 'vue'
import type { BookingRow, GetApiBookingsParams } from '@/lib/bookings-api'

const ROWS: BookingRow[] = ['2026-11-21', '2026-11-20'].map((dateFrom, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  clientId: null,
  name: `Клиент ${i}`,
  phone: '',
  car: 'Kia Rio',
  service: '',
  note: '',
  dateFrom,
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
}))

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const captured = vi.hoisted(() => ({}) as { params: ComputedRef<GetApiBookingsParams> })

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useBookingsQuery: (params: ComputedRef<GetApiBookingsParams>) => {
      captured.params = params
      return {
        data: ref({ ok: true, items: ROWS, total: 30 }),
        error: ref(null),
        asyncStatus: ref('idle'),
      }
    },
    useMastersQuery: () => ({ data: ref(undefined) }),
    useInvalidateBookings: () => vi.fn(),
  }
})

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import BookingsPage from '@/components/BookingsPage.vue'

function mountPage() {
  return mount(BookingsPage, {
    attachTo: document.body,
    global: {
      plugins: [createPinia()],
      stubs: { BookingDetailsDialog: true, BookingEditDialog: true },
    },
  })
}

const sortButton = () => page.getByRole('button', { name: /^Дата: / })
const firstRowNumber = () =>
  page.getByRole('row').nth(1).getByRole('cell').first().element().textContent?.trim()

enableAutoUnmount(afterEach)

describe('BookingsPage — сортировка по дате', () => {
  beforeEach(() => {
    localStorage.removeItem('bookings:sort')
    localStorage.removeItem('bookings:compact')
  })

  it('по умолчанию запрашивает сначала новые', async () => {
    mountPage()
    expect(captured.params.value.sort).toBe('desc')
    await expect.element(sortButton()).toHaveAccessibleName(/сначала новые/)
    // Хронологический номер: верхняя строка первой страницы — последняя из 30.
    await expect.poll(firstRowNumber).toBe('30')
  })

  it('переключает направление из заголовка «Дата» и запоминает его', async () => {
    const wrapper = mountPage()

    await sortButton().click()

    await expect.element(sortButton()).toHaveAccessibleName(/сначала старые/)
    expect(captured.params.value.sort).toBe('asc')
    await expect.poll(firstRowNumber).toBe('1')

    wrapper.unmount()
    mountPage()
    expect(captured.params.value.sort).toBe('asc')

    await sortButton().click()
    expect(captured.params.value.sort).toBe('desc')
  })
})
