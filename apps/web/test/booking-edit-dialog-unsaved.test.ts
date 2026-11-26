import { afterEach, describe, it, expect, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { BookingRow } from '@detailing-admin/shared'

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return { useMastersQuery: () => ({ data: ref(undefined) }) }
})

vi.mock('@/composables/use-days-off-warning', async () => {
  const { computed } = await vi.importActual<typeof import('vue')>('vue')
  return { useDaysOffWarning: () => computed(() => []) }
})

vi.mock('@/lib/bookings-api', () => ({ updateBooking: vi.fn() }))

import BookingEditDialog from '@/components/BookingEditDialog.vue'

const BOOKING = {
  id: '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e',
  dateFrom: '2026-06-04',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Мойка',
  note: '',
  amount: 5000,
  readiness: '',
  master: [],
  responsible: '',
  carClass: 1,
} as unknown as BookingRow

enableAutoUnmount(afterEach)

// Поля заполняются при открытии, поэтому монтируем закрытым и открываем пропом.
async function mountOpen() {
  const wrapper = mount(BookingEditDialog, {
    attachTo: document.body,
    props: { open: false, booking: BOOKING },
  })
  await wrapper.setProps({ open: true })
  await expect.element(page.getByLabelText('Имя')).toHaveValue('Иван')
  return wrapper
}

const closes = (w: Awaited<ReturnType<typeof mountOpen>>) =>
  (w.emitted('update:open') ?? []).filter(([v]) => v === false).length

describe('BookingEditDialog: несохраненные изменения', () => {
  it('без правок закрывается сразу, без предупреждения', async () => {
    const wrapper = await mountOpen()
    await page.getByRole('button', { name: 'Отмена' }).click()
    expect(closes(wrapper)).toBe(1)
    await expect.element(page.getByText('Изменения не сохранены')).not.toBeInTheDocument()
  })

  it('с правкой спрашивает подтверждение и закрывается только после него', async () => {
    const wrapper = await mountOpen()
    await page.getByLabelText('Имя').fill('Петр')
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect.element(page.getByText('Изменения не сохранены')).toBeInTheDocument()
    expect(closes(wrapper)).toBe(0)

    await page.getByRole('button', { name: 'Продолжить редактирование' }).click()
    await expect.element(page.getByText('Изменения не сохранены')).not.toBeInTheDocument()
    expect(closes(wrapper)).toBe(0)
    await expect.element(page.getByLabelText('Имя')).toHaveValue('Петр')

    await page.getByRole('button', { name: 'Отмена' }).click()
    await page.getByRole('button', { name: 'Закрыть без сохранения' }).click()
    expect(closes(wrapper)).toBe(1)
  })

  it('правка, возвращенная к исходному значению, не считается несохраненной', async () => {
    const wrapper = await mountOpen()
    await page.getByLabelText('Имя').fill('Петр')
    await page.getByLabelText('Имя').fill('Иван')
    await page.getByRole('button', { name: 'Отмена' }).click()
    expect(closes(wrapper)).toBe(1)
  })
})
