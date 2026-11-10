import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { enableAutoUnmount, mount, RouterLinkStub } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ClientLookupSummary } from '@detailing-admin/shared'
import { useAuthStore } from '@/stores/auth'
import type { Client } from '@/lib/clients-api'

// Найденным клиентом управляем напрямую через общие ref'ы — собственную проверку
// телефона в composable покрывает use-client-lookup.test.ts; здесь проверяем реакцию
// формы на совпадение. Они вынесены в hoisted, а не экспортируются из мока, потому что
// мок в browser mode теряет экспорты, которых нет у настоящего модуля.
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

// Запросы, которые срабатывают при монтировании, — отдают пустые, но ok-данные, чтобы
// список мастеров откатился на enum и ничего не осталось в состоянии загрузки.
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

// Резолвится, когда восстановление черновика и watcher'ы полей отработали, чтобы
// последующее `matched.value = …` воспринималось как изменение.
async function mountReadyForm() {
  const w = mountForm()
  await expect.element(submit()).toBeVisible()
  return w
}

enableAutoUnmount(afterEach)

describe('BookingForm — автозаполнение клиента', () => {
  beforeEach(() => {
    matched.value = null
    summary.value = null
    localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().user = { login: 'admin1', role: 'admin', firstName: '', lastName: '' }
  })

  it('при совпадении подставляет имя в пустое поле', async () => {
    await mountReadyForm()
    matched.value = client
    await expect.element(nameField()).toHaveValue('Иван')
    await expect.element(page.getByText('Найден клиент с именем: Иван')).toBeVisible()
  })

  it('при совпадении перезаписывает имя, уже введенное оператором', async () => {
    await mountReadyForm()
    await nameField().fill('Петр')
    matched.value = client
    await expect.element(nameField()).toHaveValue('Иван')
  })

  it('при совпадении подставляет в пустые поля первую машину и номер по маске', async () => {
    await mountReadyForm()
    matched.value = client
    await expect.element(carField()).toHaveValue('Toyota Camry')
    await expect.element(plateField()).toHaveValue('А123АА777')
  })

  it('переключает «Марка и модель» на другую машину по тапу на ее чип', async () => {
    await mountReadyForm()
    matched.value = client
    // Первая машина (Toyota) подставлена сама; тапаем чип второй, чтобы переключиться.
    await carChip('Kia Rio').click()
    await expect.element(carField()).toHaveValue('Kia Rio')
    await expect.element(plateField()).toHaveValue('')
  })

  it('не показывает чипы клиенту с одной машиной (она подставляется сама)', async () => {
    await mountReadyForm()
    matched.value = {
      ...client,
      cars: [{ id: 'car-1', makeModel: 'Toyota Camry', plate: 'А123АА777' }],
    }
    await expect.element(carField()).toHaveValue('Toyota Camry')
    await expect.element(carChip('Toyota Camry')).not.toBeInTheDocument()
  })

  it('без совпадения не показывает подсказку и чипы, а отправка остается доступной', async () => {
    await mountReadyForm()
    await expect.element(page.getByText(/Найден клиент/)).not.toBeInTheDocument()
    await expect.element(carChip('Toyota Camry')).not.toBeInTheDocument()
    await expect.element(submit()).toBeEnabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('при совпадении перезаписывает имя из восстановленного черновика и показывает чипы', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ phoneRaw: '+7 (916) 123-45-67', name: 'Петр' }),
    )
    await mountReadyForm()
    await expect.element(nameField()).toHaveValue('Петр')
    matched.value = client
    await expect.element(nameField()).toHaveValue('Иван')
    await expect.element(carChip('Toyota Camry')).toBeVisible()
  })

  it('сводит прошлые визиты вернувшегося клиента', async () => {
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

  it('показывает букеру сводку без денег и ссылки на карточку', async () => {
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

  it('сообщает, если у известного клиента еще нет завершенных визитов', async () => {
    await mountReadyForm()
    matched.value = client
    summary.value = {
      totalSpent: 0,
      visitCount: 0,
      lastVisit: null,
      lastService: null,
      missed: null,
    }
    await expect.element(page.getByText('Завершенных визитов еще не было')).toBeVisible()
    await expect.element(page.getByText(/Потрачено/)).not.toBeInTheDocument()
  })

  it('предупреждает о предоплате для клиента, который отменял запись или не приезжал', async () => {
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

  it('не показывает предупреждение о предоплате клиенту без отмен', async () => {
    await mountReadyForm()
    matched.value = client
    summary.value = adminSummary
    await expect.element(page.getByText('Визитов: 2 · последний 12.09.2026')).toBeVisible()
    await expect.element(page.getByText(/предоплате/)).not.toBeInTheDocument()
  })
})
