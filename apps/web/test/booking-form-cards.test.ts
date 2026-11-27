import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount, RouterLinkStub } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { today, getLocalTimeZone } from '@internationalized/date'
import { calToDdmmyyyy } from '@/lib/date'
import { BOOKING_DRAFT_KEY } from '@/lib/booking-draft'

// Карточки формы получают состояние объектами из composable, а поля вводят через
// собственные Input с v-model поверх обработчика маски. Здесь проверяем, что маска
// видна в поле и состояние доходит до владельца формы (его видно по черновику).

vi.mock('@/composables/use-client-lookup', async () => {
  const { ref: r } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useClientLookup: () => ({ matchedClient: r(null), matchedClientSummary: r(null) }),
  }
})

vi.mock('@/lib/queries', () => ({
  useMastersQuery: () => ({ data: ref({ ok: true, masters: [] }), asyncStatus: ref('idle') }),
  usePricelistQuery: () => ({ data: ref({ ok: true, sections: [] }) }),
  useScheduleQuery: (range: { value: unknown }) => {
    void range.value
    return { data: ref(undefined) }
  },
}))

vi.mock('@/lib/api', () => ({ submitBooking: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import BookingForm from '@/components/BookingForm.vue'

function mountForm() {
  return mount(BookingForm, {
    attachTo: document.body,
    global: {
      stubs: { ServicePicker: true, MasterMultiSelect: true, RouterLink: RouterLinkStub },
    },
  })
}

function savedDraft(): Record<string, unknown> {
  const raw = localStorage.getItem(BOOKING_DRAFT_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

enableAutoUnmount(afterEach)

describe('BookingForm — карточки даты и оплаты', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('маскирует дату и время и отдает их форме', async () => {
    mountForm()
    const later = calToDdmmyyyy(today(getLocalTimeZone()).add({ days: 30 }))
    const date = page.getByPlaceholder('ДД.ММ.ГГГГ')
    await date.fill(later.replaceAll('.', ''))
    await page.getByPlaceholder('ЧЧ:ММ').fill('1130')

    await expect.element(date).toHaveValue(later)
    await expect.element(page.getByPlaceholder('ЧЧ:ММ')).toHaveValue('11:30')
    await expect.poll(() => savedDraft()).toMatchObject({ dateFromText: later, timeValue: '11:30' })
  })

  it('«Диапазон» открывает окончание работ с той же датой', async () => {
    mountForm()
    await page.getByRole('button', { name: 'Диапазон' }).click()
    const todayText = calToDdmmyyyy(today(getLocalTimeZone()))
    await expect.element(page.getByText('Окончание работ')).toBeVisible()
    await expect.element(page.getByPlaceholder('ДД.ММ.ГГГГ').nth(1)).toHaveValue(todayText)
  })

  it('сумма группируется по тысячам, пресет прибавляет, скидка считает итог', async () => {
    mountForm()
    const amount = page.getByPlaceholder('0').first()
    await amount.fill('12500')
    await expect.element(amount).toHaveValue('12 500')

    await page.getByRole('button', { name: '+1 000' }).click()
    await expect.element(amount).toHaveValue('13 500')

    await page.getByPlaceholder('0').nth(1).fill('500')
    await expect.element(page.getByText('13 000 ₽', { exact: false })).toBeVisible()
    await expect.poll(() => savedDraft()).toMatchObject({ amountRaw: '13 500', discountRaw: '500' })
  })
})
