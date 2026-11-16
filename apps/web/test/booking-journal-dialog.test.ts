import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { BookingJournalEntry, BookingJournalResponse } from '@detailing-admin/shared'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const { data, requests } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    data: ref<BookingJournalResponse | undefined>(undefined),
    requests: [] as Record<string, unknown>[],
  }
})

vi.mock('@/lib/queries', async () => {
  const { ref, watchEffect } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useBookingJournalQuery: (_enabled: unknown, params: { value: Record<string, unknown> }) => {
      watchEffect(() => requests.push({ ...params.value }))
      return { data, error: ref(null), isLoading: ref(false), isPlaceholderData: ref(false) }
    },
    useAccountsQuery: () => ({
      data: ref({
        ok: true,
        accounts: [{ id: 'u-anna', login: 'anna', role: 'admin', firstName: 'Анна', lastName: '' }],
      }),
    }),
  }
})

import BookingJournalDialog from '@/components/BookingJournalDialog.vue'

const SUMMARY = {
  name: 'Иван',
  car: 'Toyota Camry',
  dateFrom: '2026-06-04',
  dateTo: null,
  timeFrom: '10:00',
}

function entry(over: Partial<BookingJournalEntry> = {}): BookingJournalEntry {
  return {
    id: 1,
    bookingId: '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e',
    action: 'update',
    actorLogin: 'admin',
    actorName: 'Анна',
    at: '2026-06-03T10:00:00.000Z',
    changes: [{ field: 'amount', from: 5000, to: 7000 }],
    booking: SUMMARY,
    deleted: false,
    ...over,
  }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  data.value = { ok: true, items: [entry()], hasMore: false }
  requests.length = 0
})

describe('BookingJournalDialog', () => {
  it('показывает событие: автора, действие, запись и изменившиеся поля', async () => {
    mount(BookingJournalDialog, { attachTo: document.body, props: { open: true } })
    await expect.element(page.getByText('Анна', { exact: true }).first()).toBeInTheDocument()
    await expect.element(page.getByText('· изменение')).toBeInTheDocument()
    await expect.element(page.getByText('Toyota Camry · Иван')).toBeInTheDocument()
    await expect.element(page.getByText('запись на 04.06, 10:00')).toBeInTheDocument()
    await expect.element(page.getByText('5 000 ₽')).toBeInTheDocument()
    await expect.element(page.getByText('7 000 ₽')).toBeInTheDocument()
  })

  it('не показывает формулу суммы и не зачеркивает пустое прежнее значение', async () => {
    data.value = {
      ok: true,
      items: [
        entry({
          changes: [
            { field: 'note', from: '', to: 'Позвонить' },
            { field: 'amountFormula', from: '=5000', to: null },
          ],
        }),
      ],
      hasMore: false,
    }
    mount(BookingJournalDialog, { attachTo: document.body, props: { open: true } })
    await expect.element(page.getByText('Позвонить')).toBeInTheDocument()
    await expect.element(page.getByText(/Формула/)).not.toBeInTheDocument()
    await expect.element(page.getByText('→')).not.toBeInTheDocument()
  })

  it('помечает запись, которой сейчас нет в таблице', async () => {
    data.value = {
      ok: true,
      items: [entry({ action: 'delete', changes: null, deleted: true })],
      hasMore: false,
    }
    mount(BookingJournalDialog, { attachTo: document.body, props: { open: true } })
    await expect.element(page.getByText('· удаление')).toBeInTheDocument()
    await expect.element(page.getByText('удалена', { exact: true })).toBeInTheDocument()
  })

  it('«Показать еще» увеличивает limit, а без продолжения кнопки нет', async () => {
    data.value = { ok: true, items: [entry()], hasMore: true }
    mount(BookingJournalDialog, { attachTo: document.body, props: { open: true } })
    await page.getByRole('button', { name: 'Показать еще' }).click()
    await vi.waitFor(() => expect(requests.at(-1)?.limit).toBe(100))

    data.value = { ok: true, items: [entry()], hasMore: false }
    await expect.element(page.getByRole('button', { name: 'Показать еще' })).not.toBeInTheDocument()
  })

  it('фильтр по действию уходит в запрос и сбрасывает подгрузку', async () => {
    data.value = { ok: true, items: [entry()], hasMore: true }
    mount(BookingJournalDialog, { attachTo: document.body, props: { open: true } })
    await page.getByRole('button', { name: 'Показать еще' }).click()
    await vi.waitFor(() => expect(requests.at(-1)?.limit).toBe(100))

    await page.getByRole('combobox', { name: 'Действие' }).click()
    await page.getByRole('option', { name: 'Удаление' }).click()
    await vi.waitFor(() => expect(requests.at(-1)).toMatchObject({ action: 'delete', limit: 50 }))
  })

  it('показывает пустой журнал', async () => {
    data.value = { ok: true, items: [], hasMore: false }
    mount(BookingJournalDialog, { attachTo: document.body, props: { open: true } })
    await expect.element(page.getByText('Событий пока нет')).toBeInTheDocument()
  })
})
