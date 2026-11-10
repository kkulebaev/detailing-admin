import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { DeletedBooking, DeletedBookingsResponse } from '@detailing-admin/shared'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const { data, invalidate, restoreMock, toastMock } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    data: ref<DeletedBookingsResponse | undefined>(undefined),
    invalidate: vi.fn(),
    restoreMock: vi.fn(),
    toastMock: { error: vi.fn(), success: vi.fn() },
  }
})

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useDeletedBookingsQuery: () => ({ data, error: ref(null), isLoading: ref(false) }),
    useInvalidateBookings: () => invalidate,
  }
})

vi.mock('@/lib/bookings-api', () => ({
  restoreBooking: (...args: unknown[]) => restoreMock(...args),
}))

vi.mock('vue-sonner', () => ({ toast: toastMock }))

import DeletedBookingsDialog from '@/components/DeletedBookingsDialog.vue'

const ID = '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e'

const BOOKING = {
  id: ID,
  clientId: null,
  name: 'Иван',
  phone: '+79001234567',
  car: 'Toyota Camry',
  service: 'Мойка',
  note: '',
  amount: 7000,
  amountFormula: null,
  dateFrom: '2026-06-04',
  dateTo: null,
  timeFrom: '10:00',
  timeTo: null,
  readiness: 'Выдана',
  master: ['Мастер А'],
  responsible: 'Мастер А',
  carClass: 2,
  sheetRow: 5,
  sheetRange: null,
  createdAt: '2026-06-01T12:00:00.000Z',
} satisfies DeletedBooking['booking']

function deleted(): DeletedBookingsResponse {
  return {
    ok: true,
    items: [{ booking: BOOKING, deletedAt: '2026-06-03T10:00:00.000Z', deletedBy: 'Анна' }],
  }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  data.value = deleted()
  restoreMock.mockReset()
  invalidate.mockReset()
  toastMock.error.mockReset()
  toastMock.success.mockReset()
})

describe('DeletedBookingsDialog', () => {
  it('показывает удаленную запись с суммой и автором удаления', async () => {
    mount(DeletedBookingsDialog, { attachTo: document.body, props: { open: true } })
    await expect.element(page.getByText('Toyota Camry')).toBeInTheDocument()
    await expect.element(page.getByText(/7 000 ₽/)).toBeInTheDocument()
    await expect.element(page.getByText(/Удалил\(а\) Анна/)).toBeInTheDocument()
  })

  it('восстанавливает запись и обновляет списки', async () => {
    restoreMock.mockResolvedValue({ ok: true, booking: BOOKING })
    mount(DeletedBookingsDialog, { attachTo: document.body, props: { open: true } })
    await page.getByRole('button', { name: 'Восстановить' }).click()
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    expect(restoreMock).toHaveBeenCalledWith(ID)
    expect(toastMock.success).toHaveBeenCalledWith('Запись восстановлена')
  })

  it('сообщает, что запись уже восстановили в другом окне', async () => {
    restoreMock.mockResolvedValue({ ok: false, error: 'conflict', reason: 'already_restored' })
    mount(DeletedBookingsDialog, { attachTo: document.body, props: { open: true } })
    await page.getByRole('button', { name: 'Восстановить' }).click()
    await vi.waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Запись уже восстановлена'))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('показывает пустую корзину', async () => {
    data.value = { ok: true, items: [] }
    mount(DeletedBookingsDialog, { attachTo: document.body, props: { open: true } })
    await expect.element(page.getByText('Удаленных записей нет')).toBeInTheDocument()
  })
})
