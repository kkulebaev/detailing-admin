import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h, type ComputedRef } from 'vue'
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

// Popover teleports its content and only renders it when open; the slot-only
// stubs keep the period buttons reachable from the wrapper. A render function,
// because the browser build of Vue has no template compiler.
const slotStub = defineComponent((_, { slots }) => () => h('div', slots.default?.()))

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

  it('keeps the default-period empty state while offering a reset', () => {
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Нет записей с сегодняшнего дня')
    expect(wrapper.text()).not.toContain('Ничего не найдено')
    expect(buttonByText(wrapper, 'Сбросить').exists()).toBe(true)
  })

  it('switches the default period to «Все записи» on reset', async () => {
    const wrapper = mountPage()

    await buttonByText(wrapper, 'Сбросить').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
    expect(wrapper.text()).not.toContain('С 05.11.2026')
  })

  it('switches a chosen month to «Все записи» on reset', async () => {
    const wrapper = mountPage()

    await buttonByText(wrapper, 'Весь месяц').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBe('01.11.2026')
    expect(wrapper.text()).toContain('Ничего не найдено')

    await buttonByText(wrapper, 'Сбросить').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
  })

  it('hides the reset when «Все записи» has nothing left to clear', async () => {
    const wrapper = mountPage()

    await buttonByText(wrapper, 'Все записи').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(wrapper.text()).not.toContain('Сбросить')
    expect(wrapper.text()).toContain('Записей пока нет')
    expect(wrapper.text()).not.toContain('Показать все записи')
  })

  it('returns to the default on «С сегодня»', async () => {
    const wrapper = mountPage()

    await buttonByText(wrapper, 'Все записи').trigger('click')
    await buttonByText(wrapper, 'С сегодня').trigger('click')
    await flushPromises()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
  })
})
