// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, RouterLinkStub, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ClientLookupSummary } from '@detailing-admin/shared'
import { useAuthStore } from '@/stores/auth'
import type { Client } from '@/lib/clients-api'

// The matched client is driven directly through a shared ref exposed by the
// mocked composable — the composable's own phone gating is covered in
// use-client-lookup.test.ts; here we exercise the form's reaction to a match.
vi.mock('@/composables/use-client-lookup', async () => {
  const { ref: r } = await vi.importActual<typeof import('vue')>('vue')
  const matchedClient = r<Client | null>(null)
  const matchedClientSummary = r<ClientLookupSummary | null>(null)
  return {
    useClientLookup: () => ({ matchedClient, matchedClientSummary }),
    __matchedClient: matchedClient,
    __summary: matchedClientSummary,
  }
})

// Queries that fire on mount — return empty-but-ok data so the master options
// fall back to the enum and nothing is left in a loading state.
vi.mock('@/lib/queries', () => ({
  useMastersQuery: () => ({ data: ref({ ok: true, masters: [] }), asyncStatus: ref('idle') }),
  usePricelistQuery: () => ({ data: ref({ ok: true, sections: [] }) }),
}))

vi.mock('@/lib/api', () => ({ submitBooking: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import BookingForm from '@/components/BookingForm.vue'
import * as lookupMock from '@/composables/use-client-lookup'
import { toast } from 'vue-sonner'

const matched = (lookupMock as unknown as { __matchedClient: { value: Client | null } }).__matchedClient
const summary = (lookupMock as unknown as { __summary: { value: ClientLookupSummary | null } }).__summary

const client: Client = {
  id: '11111111-1111-1111-1111-111111111111',
  phone: '+79161234567',
  name: 'Иван',
  createdAt: '2026-01-01T00:00:00.000Z',
  cars: [
    { id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА777' },
    { id: 'car-2', makeModel: 'Kia Rio', plate: '' },
  ],
}

const adminSummary: ClientLookupSummary = {
  totalSpent: 48000,
  visitCount: 2,
  lastVisit: '2026-09-12',
  lastService: 'Полировка: кузов',
  missed: null,
}

const DRAFT_KEY = 'detailing-admin:booking-draft:v5'

function mountForm() {
  return mount(BookingForm, {
    attachTo: document.body,
    global: {
      stubs: { ServicePicker: true, MasterMultiSelect: true, RouterLink: RouterLinkStub },
    },
  })
}

function inputByPlaceholder(w: VueWrapper, placeholder: string): HTMLInputElement {
  return w.find(`input[placeholder="${placeholder}"]`).element as HTMLInputElement
}

function carChip(w: VueWrapper, makeModel: string) {
  return w.findAll('button').find((b) => b.text().includes(makeModel))
}

describe('BookingForm — client autofill', () => {
  beforeEach(() => {
    matched.value = null
    summary.value = null
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().user = { login: 'admin1', role: 'admin', firstName: '', lastName: '' }
  })

  it('autofills the name into an empty field on match', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    await flushPromises()
    expect(inputByPlaceholder(w, 'Иван').value).toBe('Иван')
    expect(w.text()).toContain('Найден клиент с именем: Иван')
    w.unmount()
  })

  it('overwrites a name the operator already typed on match', async () => {
    const w = mountForm()
    await flushPromises()
    await w.find('input[placeholder="Иван"]').setValue('Пётр')
    matched.value = client
    await flushPromises()
    expect(inputByPlaceholder(w, 'Иван').value).toBe('Иван')
    w.unmount()
  })

  it('autofills the first car and masked plate into empty fields on match', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    await flushPromises()
    expect(inputByPlaceholder(w, 'Toyota Camry').value).toBe('Toyota Camry')
    expect(inputByPlaceholder(w, 'А123АА777').value).toBe('А123АА777')
    w.unmount()
  })

  it('switches «Марка и модель» to another car when its chip is tapped', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    await flushPromises()
    // First car (Toyota) is auto-filled; tap the second car's chip to switch.
    const chip = carChip(w, 'Kia Rio')
    expect(chip).toBeTruthy()
    await chip!.trigger('click')
    await flushPromises()
    expect(inputByPlaceholder(w, 'Toyota Camry').value).toBe('Kia Rio')
    expect(inputByPlaceholder(w, 'А123АА777').value).toBe('')
    w.unmount()
  })

  it('shows no chips for a single-car client (the one car is auto-filled)', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = { ...client, cars: [{ id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА777' }] }
    await flushPromises()
    expect(inputByPlaceholder(w, 'Toyota Camry').value).toBe('Toyota Camry')
    expect(carChip(w, 'Toyota Camry')).toBeUndefined()
    w.unmount()
  })

  it('shows no hint or chips without a match, and submit stays available', async () => {
    const w = mountForm()
    await flushPromises()
    expect(w.text()).not.toContain('Найден клиент')
    expect(carChip(w, 'Toyota Camry')).toBeUndefined()
    const submit = w.findAll('button').find((b) => b.text().includes('Сохранить запись'))
    expect(submit?.attributes('disabled')).toBeUndefined()
    expect(toast.error).not.toHaveBeenCalled()
    w.unmount()
  })

  it('overwrites a restored draft name on match and shows the chips', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ phoneRaw: '+7 (916) 123-45-67', name: 'Пётр' }))
    const w = mountForm()
    await flushPromises()
    expect(inputByPlaceholder(w, 'Иван').value).toBe('Пётр')
    matched.value = client
    await flushPromises()
    expect(inputByPlaceholder(w, 'Иван').value).toBe('Иван')
    expect(carChip(w, 'Toyota Camry')).toBeTruthy()
    w.unmount()
  })

  it('summarises past visits of a returning client', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    summary.value = adminSummary
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Визитов: 2 · последний 12.09.2026')
    expect(text).toContain('Потрачено: 48 000 ₽')
    expect(text).toContain('Последнее: Полировка: кузов')
    const link = w.findComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({ name: 'client-detail', params: { id: client.id } })
    expect(link.attributes('target')).toBe('_blank')
    w.unmount()
  })

  it('shows a booker the summary without money or the card link', async () => {
    useAuthStore().user = { login: 'booker1', role: 'booker', firstName: '', lastName: '' }
    const { totalSpent: _hiddenByServer, ...bookerSummary } = adminSummary
    const w = mountForm()
    await flushPromises()
    matched.value = client
    summary.value = bookerSummary
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Визитов: 2 · последний 12.09.2026')
    expect(text).toContain('Последнее: Полировка: кузов')
    expect(text).not.toContain('Потрачено')
    expect(w.findComponent(RouterLinkStub).exists()).toBe(false)
    w.unmount()
  })

  it('says so when a known client has no delivered visits yet', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    summary.value = { totalSpent: 0, visitCount: 0, lastVisit: null, lastService: null, missed: null }
    await flushPromises()
    expect(w.text()).toContain('Завершённых визитов ещё не было')
    expect(w.text()).not.toContain('Потрачено')
    w.unmount()
  })

  it('warns to take a prepayment from a client who cancelled or did not show up', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    summary.value = {
      ...adminSummary,
      missed: { cancelled: 1, noShow: 1, lastDate: '2026-10-01' },
    }
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Записывать только по предоплате')
    expect(text).toContain('Отменял запись: 1 · Не приезжал: 1. Последний раз — 01.10.2026')
    w.unmount()
  })

  it('shows no prepayment warning for a client without cancellations', async () => {
    const w = mountForm()
    await flushPromises()
    matched.value = client
    summary.value = adminSummary
    await flushPromises()
    expect(w.text()).not.toContain('предоплате')
    w.unmount()
  })
})
