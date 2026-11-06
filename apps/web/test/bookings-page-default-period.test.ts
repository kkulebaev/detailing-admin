import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createPinia } from 'pinia'
import type { ComputedRef } from 'vue'
import type { GetApiBookingsParams } from '@/lib/bookings-api'

// Hoisted rather than exported from the mock: a browser-mode mock drops exports
// the real module doesn't have.
const captured = vi.hoisted(() => ({}) as { params: ComputedRef<GetApiBookingsParams> })

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useBookingsQuery: (params: ComputedRef<GetApiBookingsParams>) => {
      captured.params = params
      return {
        data: ref({ ok: true, items: [], total: 0 }),
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
      stubs: {
        BookingDetailsDialog: true,
        BookingEditDialog: true,
      },
    },
  })
}

const button = (name: string) => page.getByRole('button', { name })

// Period actions live in a popover opened from the button that names the period.
async function choosePeriod(from: string, action: string) {
  await button(from).click()
  await button(action).click()
  // «Все записи» is both an action in the popover and the trigger's next label.
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
}

enableAutoUnmount(afterEach)

describe('BookingsPage default period', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 5, 12) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests bookings from today with an open end', async () => {
    mountPage()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
    expect(captured.params.value.dateTo).toBeUndefined()
    await expect.element(button('С 05.11.2026')).toBeVisible()
  })

  it('keeps the default-period empty state while offering a reset', async () => {
    mountPage()
    await expect.element(page.getByText('Нет записей с сегодняшнего дня')).toBeVisible()
    await expect.element(page.getByText('Ничего не найдено')).not.toBeInTheDocument()
    await expect.element(button('Сбросить')).toBeVisible()
  })

  it('switches the default period to «Все записи» on reset', async () => {
    mountPage()

    await button('Сбросить').click()

    await expect.element(button('Все записи')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
    await expect.element(button('С 05.11.2026')).not.toBeInTheDocument()
  })

  it('switches a chosen month to «Все записи» on reset', async () => {
    mountPage()

    await choosePeriod('С 05.11.2026', 'Весь месяц')
    await expect.element(page.getByText('Ничего не найдено')).toBeVisible()
    expect(captured.params.value.dateFrom).toBe('01.11.2026')

    await button('Сбросить').click()

    await expect.element(button('Все записи')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
  })

  it('hides the reset when «Все записи» has nothing left to clear', async () => {
    mountPage()

    await choosePeriod('С 05.11.2026', 'Все записи')

    await expect.element(page.getByText('Записей пока нет')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    await expect.element(button('Сбросить')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /Показать все записи/ })).not.toBeInTheDocument()
  })

  it('returns to the default on «С сегодня»', async () => {
    mountPage()

    await choosePeriod('С 05.11.2026', 'Все записи')
    await choosePeriod('Все записи', 'С сегодня')

    await expect.element(button('С 05.11.2026')).toBeVisible()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
  })
})
