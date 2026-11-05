// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { ComputedRef } from 'vue'
import type { GetApiBookingsParams } from '@/lib/bookings-api'

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  const captured: { params?: ComputedRef<GetApiBookingsParams> } = {}
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
    __captured: captured,
  }
})

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import BookingsPage from '@/components/BookingsPage.vue'
import * as queriesMock from '@/lib/queries'

const captured = (
  queriesMock as unknown as {
    __captured: { params: ComputedRef<GetApiBookingsParams> }
  }
).__captured

// Popover teleports its content and only renders it when open; the slot-only
// stubs keep the period buttons reachable from the wrapper.
const slotStub = { template: '<div><slot /></div>' }

function mountPage() {
  return mount(BookingsPage, {
    global: {
      plugins: [createPinia()],
      stubs: {
        Popover: slotStub,
        PopoverTrigger: slotStub,
        PopoverContent: slotStub,
        Calendar: true,
        BookingDetailsDialog: true,
        BookingEditDialog: true,
      },
    },
  })
}

function buttonByText(wrapper: ReturnType<typeof mountPage>, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === text)
  if (!button) throw new Error(`no button «${text}»`)
  return button
}

describe('BookingsPage default period', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 5, 12) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests bookings from today with an open end', () => {
    const wrapper = mountPage()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
    expect(captured.params.value.dateTo).toBeUndefined()
    expect(wrapper.text()).toContain('С 05.11.2026')
  })

  it('treats the default period as no active filter', () => {
    const wrapper = mountPage()
    expect(wrapper.text()).not.toContain('Сбросить фильтры')
    expect(wrapper.text()).toContain('Нет записей с сегодняшнего дня')
  })

  it('drops the date filter on «Все записи» and restores the default on reset', async () => {
    const wrapper = mountPage()

    await buttonByText(wrapper, 'Все записи').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()

    await buttonByText(wrapper, 'Сбросить фильтры').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
    expect(captured.params.value.dateTo).toBeUndefined()
  })

  it('returns to the default on «С сегодня»', async () => {
    const wrapper = mountPage()

    await buttonByText(wrapper, 'Все записи').trigger('click')
    await buttonByText(wrapper, 'С сегодня').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
  })
})
