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
import { createTestRouter } from './helpers/router'

async function mountPage(path = '/') {
  const router = await createTestRouter(path)
  return mount(BookingsPage, {
    attachTo: document.body,
    global: {
      plugins: [createPinia(), router],
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
    await mountPage()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
    expect(captured.params.value.dateTo).toBeUndefined()
    await expect.element(button('С 05.11.2026')).toBeVisible()
  })

  it('оставляет пустое состояние периода по умолчанию и предлагает сброс', async () => {
    await mountPage()
    await expect.element(page.getByText('Нет записей с сегодняшнего дня')).toBeVisible()
    await expect.element(page.getByText('Ничего не найдено')).not.toBeInTheDocument()
    await expect.element(button('Сбросить')).toBeVisible()
  })

  it('при сбросе переключает период по умолчанию на «Все записи»', async () => {
    await mountPage()

    await button('Сбросить').click()

    await expect.element(button('Все записи')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
    await expect.element(button('С 05.11.2026')).not.toBeInTheDocument()
  })

  it('при сбросе переключает выбранный месяц на «Все записи»', async () => {
    await mountPage()

    await choosePeriod('С 05.11.2026', 'Весь месяц')
    await expect.element(page.getByText('Ничего не найдено')).toBeVisible()
    expect(captured.params.value.dateFrom).toBe('01.11.2026')

    await button('Сбросить').click()

    await expect.element(button('Все записи')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    expect(captured.params.value.dateTo).toBeUndefined()
  })

  it('прячет сброс, когда в «Все записи» сбрасывать уже нечего', async () => {
    await mountPage()

    await choosePeriod('С 05.11.2026', 'Все записи')

    await expect.element(page.getByText('Записей пока нет')).toBeVisible()
    expect(captured.params.value.dateFrom).toBeUndefined()
    await expect.element(button('Сбросить')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: /Показать все записи/ }))
      .not.toBeInTheDocument()
  })

  it('возвращается к умолчанию по «С сегодня»', async () => {
    await mountPage()

    await choosePeriod('С 05.11.2026', 'Все записи')
    await choosePeriod('Все записи', 'С сегодня')

    await expect.element(button('С 05.11.2026')).toBeVisible()
    expect(captured.params.value.dateFrom).toBe('05.11.2026')
  })

  describe('фильтры в адресе', () => {
    it('открывает месяц, мастера, готовность и страницу из адреса', async () => {
      await mountPage(
        `/?period=2026-10&master=${encodeURIComponent('Иван')}&readiness=${encodeURIComponent('none,В работе,Выдана,Чужой')}&page=2`,
      )

      expect(captured.params.value).toMatchObject({
        dateFrom: '01.10.2026',
        dateTo: '31.10.2026',
        master: 'Иван',
        readiness: 'В работе,Выдана,none',
        offset: 50,
      })
      await expect.element(button('Октябрь 2026')).toBeVisible()
    })

    it('выбирает несколько статусов готовности и пишет их в адрес', async () => {
      const wrapper = await mountPage('/?page=2')
      const router = wrapper.vm.$router

      await button('Фильтры').click()
      await button('Готовность').click()
      await page.getByRole('checkbox', { name: 'Нет статуса' }).click()
      await page.getByRole('checkbox', { name: 'Выдана' }).click()
      await page.getByRole('checkbox', { name: 'В работе' }).click()

      // Порядок справочника, а не кликов: один набор — один адрес.
      await expect
        .poll(() => router.currentRoute.value.query)
        .toEqual({ readiness: 'В работе,Выдана,none' })
      expect(captured.params.value).toMatchObject({ readiness: 'В работе,Выдана,none', offset: 0 })
      await expect.element(button('Готовность')).toHaveTextContent('В работе +2')

      await button('Все статусы').click()
      await expect.poll(() => router.currentRoute.value.query).toEqual({})
      expect(captured.params.value.readiness).toBeUndefined()
    })

    it('открывает день из адреса', async () => {
      await mountPage('/?period=2026-11-12')

      expect(captured.params.value).toMatchObject({ dateFrom: '12.11.2026', dateTo: '12.11.2026' })
      await expect.element(button('12.11.2026')).toBeVisible()
    })

    it('смена периода пишется в адрес и сбрасывает страницу', async () => {
      const wrapper = await mountPage('/?page=3')
      const router = wrapper.vm.$router

      await choosePeriod('С 05.11.2026', 'Все записи')

      await expect.poll(() => router.currentRoute.value.query).toEqual({ period: 'all' })
      expect(captured.params.value.offset).toBe(0)
    })

    it('адрес без периода возвращает календарь на текущий месяц', async () => {
      const wrapper = await mountPage('/?period=2026-03')
      const router = wrapper.vm.$router

      await router.push('/')
      await choosePeriod('С 05.11.2026', 'Весь месяц')

      expect(captured.params.value).toMatchObject({ dateFrom: '01.11.2026', dateTo: '30.11.2026' })
    })
  })
})
