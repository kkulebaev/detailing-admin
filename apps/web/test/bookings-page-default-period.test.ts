import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createPinia } from 'pinia'
import type { ComputedRef } from 'vue'
import type { GetApiBookingsParams } from '@/lib/bookings-api'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
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

// Действия с периодом живут в поповере, который открывается кнопкой с названием периода.
async function choosePeriod(from: string, action: string) {
  await button(from).click()
  await button(action).click()
  // «Все записи» — это и действие в поповере, и следующая подпись триггера.
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
}

enableAutoUnmount(afterEach)

describe('BookingsPage — период по умолчанию', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 5, 12) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('запрашивает записи с сегодняшнего дня без конечной даты', async () => {
    mountPage()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
    expect(captured.params.value.dateTo).toBeUndefined()
    await expect.element(button('С 05.11.2026')).toBeVisible()
  })

  it('оставляет пустое состояние периода по умолчанию и предлагает сброс', async () => {
    mountPage()
    await expect.element(page.getByText('Нет записей с сегодняшнего дня')).toBeVisible()
    await expect.element(page.getByText('Ничего не найдено')).not.toBeInTheDocument()
    await expect.element(button('Сбросить')).toBeVisible()
  })

  it('при сбросе переключает период по умолчанию на «Все записи»', async () => {
    mountPage()

    await button('Сбросить').click()

    await expect.element(button('Все записи')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
    await expect.element(button('С 05.11.2026')).not.toBeInTheDocument()
  })

  it('при сбросе переключает выбранный месяц на «Все записи»', async () => {
    mountPage()

    await choosePeriod('С 05.11.2026', 'Весь месяц')
    await expect.element(page.getByText('Ничего не найдено')).toBeVisible()
    expect(captured.params.value.dateFrom).toBe('01.11.2026')

    await button('Сбросить').click()

    await expect.element(button('Все записи')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
  })

  it('прячет сброс, когда в «Все записи» сбрасывать уже нечего', async () => {
    mountPage()

    await choosePeriod('С 05.11.2026', 'Все записи')

    await expect.element(page.getByText('Записей пока нет')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    await expect.element(button('Сбросить')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Показать все записи/ }))
      .not.toBeInTheDocument()
  })

  it('возвращается к умолчанию по «С сегодня»', async () => {
    mountPage()

    await choosePeriod('С 05.11.2026', 'Все записи')
    await choosePeriod('Все записи', 'С сегодня')

    await expect.element(button('С 05.11.2026')).toBeVisible()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
  })
})
