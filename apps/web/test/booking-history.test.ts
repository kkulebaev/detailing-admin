import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { BookingAuditEntry, BookingHistoryResponse } from '@detailing-admin/shared'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const { data } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { data: ref<BookingHistoryResponse | undefined>(undefined) }
})

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useBookingHistoryQuery: () => ({ data, error: ref(null), isLoading: ref(false) }),
  }
})

import BookingHistory from '@/components/BookingHistory.vue'

const UPDATE: BookingAuditEntry = {
  id: 2,
  action: 'update',
  actorLogin: 'anna',
  actorName: 'Анна',
  at: '2026-11-10T10:00:00.000Z',
  changes: [{ field: 'readiness', from: 'Подтвердил', to: 'В работе' }],
}

const props = {
  bookingId: '4f6d8b2a-1c3e-4a5b-9d7f-0e1a2b3c4d5e',
  createdAt: '2026-11-04T14:47:00.000Z',
  initiallyExpanded: true,
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  data.value = { ok: true, items: [UPDATE] }
})

describe('BookingHistory', () => {
  it('у записи старше журнала достраивает создание без автора', async () => {
    mount(BookingHistory, { attachTo: document.body, props })
    await expect.element(page.getByText('· изменение')).toBeInTheDocument()
    await expect.element(page.getByText('Создание', { exact: true }).last()).toBeInTheDocument()
    await expect.element(page.getByText(/Автор неизвестен/)).toBeInTheDocument()
  })

  it('не дублирует создание, если оно есть в журнале', async () => {
    data.value = {
      ok: true,
      items: [{ ...UPDATE, id: 1, action: 'create', changes: null, at: props.createdAt }, UPDATE],
    }
    mount(BookingHistory, { attachTo: document.body, props })
    await expect.element(page.getByText('· создание')).toBeInTheDocument()
    await expect.element(page.getByText(/Автор неизвестен/)).not.toBeInTheDocument()
  })

  it('свернута, пока ее не раскрыли', async () => {
    mount(BookingHistory, {
      attachTo: document.body,
      props: { ...props, initiallyExpanded: false },
    })
    await expect
      .element(page.getByRole('button', { name: 'История изменений' }))
      .toBeInTheDocument()
    await expect.element(page.getByText('· изменение')).not.toBeInTheDocument()
  })
})
