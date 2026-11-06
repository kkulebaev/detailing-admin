import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { enableAutoUnmount, mount, RouterLinkStub } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ClientLookupSummary } from '@detailing-admin/shared'
import { useAuthStore } from '@/stores/auth'
import type { Client } from '@/lib/clients-api'

// The matched client is driven directly through shared refs — the composable's
// own phone gating is covered in use-client-lookup.test.ts; here we exercise the
// form's reaction to a match. They are hoisted rather than exported from the mock
// because a browser-mode mock drops exports the real module doesn't have.
const { matched, summary } = await vi.hoisted(async () => {
  const { ref: r } = await import('vue')
  return {
    matched: r<Client | null>(null),
    summary: r<ClientLookupSummary | null>(null),
  }
})

vi.mock('@/composables/use-client-lookup', () => ({
  useClientLookup: () => ({ matchedClient: matched, matchedClientSummary: summary }),
}))

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
import { toast } from 'vue-sonner'

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

const nameField = () => page.getByLabelText('Имя')
const carField = () => page.getByLabelText('Марка и модель')
const plateField = () => page.getByPlaceholder('А123АА777')
const carChip = (makeModel: string) =>
  page.getByRole('button', { name: new RegExp(`^Заполнить авто ${makeModel}`) })
const submit = () => page.getByRole('button', { name: 'Сохранить запись' })

// Resolves once the draft restore and field watchers settled, so a later
// `matched.value = …` is seen as a change.
async function mountReadyForm() {
  const w = mountForm()
  await expect.element(submit()).toBeVisible()
  return w
}

enableAutoUnmount(afterEach)

describe('BookingForm — client autofill', () => {
  beforeEach(() => {
    matched.value = null
    summary.value = null
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().user = { login: 'admin1', role: 'admin', firstName: '', lastName: '' }
  })

  it('autofills the name into an empty field on match', async () => {
    await mountReadyForm()
    matched.value = client
    await expect.element(nameField()).toHaveValue('Иван')
    await expect.element(page.getByText('Найден клиент с именем: Иван')).toBeVisible()
  })

  it('overwrites a name the operator already typed on match', async () => {
    await mountReadyForm()
    await nameField().fill('Пётр')
    matched.value = client
    await expect.element(nameField()).toHaveValue('Иван')
  })

  it('autofills the first car and masked plate into empty fields on match', async () => {
    await mountReadyForm()
    matched.value = client
    await expect.element(carField()).toHaveValue('Toyota Camry')
    await expect.element(plateField()).toHaveValue('А123АА777')
  })

  it('switches «Марка и модель» to another car when its chip is tapped', async () => {
    await mountReadyForm()
    matched.value = client
    // First car (Toyota) is auto-filled; tap the second car's chip to switch.
    await carChip('Kia Rio').click()
    await expect.element(carField()).toHaveValue('Kia Rio')
    await expect.element(plateField()).toHaveValue('')
  })

  it('shows no chips for a single-car client (the one car is auto-filled)', async () => {
    await mountReadyForm()
    matched.value = { ...client, cars: [{ id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА777' }] }
    await expect.element(carField()).toHaveValue('Toyota Camry')
    await expect.element(carChip('Toyota Camry')).not.toBeInTheDocument()
  })

  it('shows no hint or chips without a match, and submit stays available', async () => {
    await mountReadyForm()
    await expect.element(page.getByText(/Найден клиент/)).not.toBeInTheDocument()
    await expect.element(carChip('Toyota Camry')).not.toBeInTheDocument()
    await expect.element(submit()).toBeEnabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('overwrites a restored draft name on match and shows the chips', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ phoneRaw: '+7 (916) 123-45-67', name: 'Пётр' }))
    await mountReadyForm()
    await expect.element(nameField()).toHaveValue('Пётр')
    matched.value = client
    await expect.element(nameField()).toHaveValue('Иван')
    await expect.element(carChip('Toyota Camry')).toBeVisible()
  })

  it('summarises past visits of a returning client', async () => {
    const w = await mountReadyForm()
    matched.value = client
    summary.value = adminSummary
    await expect.element(page.getByText('Визитов: 2 · последний 12.09.2026')).toBeVisible()
    await expect.element(page.getByText('Потрачено: 48 000 ₽')).toBeVisible()
    await expect.element(page.getByText('Последнее: Полировка: кузов')).toBeVisible()
    const link = w.findComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({ name: 'client-detail', params: { id: client.id } })
    expect(link.attributes('target')).toBe('_blank')
  })

  it('shows a booker the summary without money or the card link', async () => {
    useAuthStore().user = { login: 'booker1', role: 'booker', firstName: '', lastName: '' }
    const { totalSpent: _hiddenByServer, ...bookerSummary } = adminSummary
    const w = await mountReadyForm()
    matched.value = client
    summary.value = bookerSummary
    await expect.element(page.getByText('Визитов: 2 · последний 12.09.2026')).toBeVisible()
    await expect.element(page.getByText('Последнее: Полировка: кузов')).toBeVisible()
    await expect.element(page.getByText(/Потрачено/)).not.toBeInTheDocument()
    expect(w.findComponent(RouterLinkStub).exists()).toBe(false)
  })

  it('says so when a known client has no delivered visits yet', async () => {
    await mountReadyForm()
    matched.value = client
    summary.value = { totalSpent: 0, visitCount: 0, lastVisit: null, lastService: null, missed: null }
    await expect.element(page.getByText('Завершённых визитов ещё не было')).toBeVisible()
    await expect.element(page.getByText(/Потрачено/)).not.toBeInTheDocument()
  })

  it('warns to take a prepayment from a client who cancelled or did not show up', async () => {
    await mountReadyForm()
    matched.value = client
    summary.value = {
      ...adminSummary,
      missed: { cancelled: 1, noShow: 1, lastDate: '2026-10-01' },
    }
    await expect.element(page.getByText('Записывать только по предоплате')).toBeVisible()
    await expect
      .element(page.getByText('Отменял запись: 1 · Не приезжал: 1. Последний раз — 01.10.2026'))
      .toBeVisible()
  })

  it('shows no prepayment warning for a client without cancellations', async () => {
    await mountReadyForm()
    matched.value = client
    summary.value = adminSummary
    await expect.element(page.getByText('Визитов: 2 · последний 12.09.2026')).toBeVisible()
    await expect.element(page.getByText(/предоплате/)).not.toBeInTheDocument()
  })
})
