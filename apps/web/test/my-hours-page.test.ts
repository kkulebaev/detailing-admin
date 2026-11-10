import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { MySalaryOk } from '@detailing-admin/shared'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const data = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return ref<MySalaryOk | undefined>(undefined)
})

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useMySalaryQuery: () => ({ data, error: ref(null), asyncStatus: ref('idle') }),
    useInvalidateMySalary: () => vi.fn(),
  }
})

vi.mock('@/lib/me-api', () => ({ deleteMyWorkHours: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import MyHoursPage from '@/pages/MyHoursPage.vue'

const linked: MySalaryOk = {
  ok: true,
  month: '2026-10',
  master: { id: 4, name: 'Пётр' },
  hourlyRate: 300,
  totalMinutes: 960,
  hoursSalary: 4800,
  payoutsTotal: -500,
  total: 4300,
  editableFrom: '2026-10-20',
  editableTo: '2026-10-26',
  entries: [
    {
      kind: 'hours',
      id: 1,
      masterId: 4,
      workDate: '2026-10-10',
      minutes: 480,
      rateSnapshot: 300,
      note: '',
      createdAt: '2026-10-10T18:00:00.000Z',
    },
    {
      kind: 'payout',
      id: 2,
      masterId: 4,
      payoutDate: '2026-10-15',
      amount: -500,
      note: 'штраф',
      createdAt: '2026-10-15T10:00:00.000Z',
    },
    {
      kind: 'hours',
      id: 3,
      masterId: 4,
      workDate: '2026-10-24',
      minutes: 480,
      rateSnapshot: 300,
      note: '',
      createdAt: '2026-10-24T18:00:00.000Z',
    },
  ],
}

function mountPage() {
  return mount(MyHoursPage, {
    attachTo: document.body,
    global: { stubs: { WorkHoursFormDialog: true } },
  })
}

const addHours = () => page.getByRole('button', { name: 'Добавить часы' })

enableAutoUnmount(afterEach)

describe('MyHoursPage', () => {
  beforeEach(() => {
    data.value = undefined
  })

  it('объясняет, что аккаунт не привязан, вместо того чтобы показывать нули', async () => {
    data.value = { ...linked, master: null, entries: [], hourlyRate: null }
    mountPage()
    await expect.element(page.getByText('Аккаунт не привязан к мастеру')).toBeVisible()
    await expect.element(addHours()).not.toBeInTheDocument()
  })

  it('показывает итоги за месяц', async () => {
    data.value = linked
    const w = mountPage()
    await expect.element(addHours()).toBeVisible()
    const text = w.text()
    expect(text).toContain('Пётр')
    expect(text).toContain('4 800 ₽')
    expect(text).toContain('−500 ₽')
    expect(text).toContain('4 300 ₽')
    expect(text).toContain('Вычет')
  })

  it('предлагает редактирование и удаление только для часов внутри окна', async () => {
    data.value = linked
    mountPage()
    await expect
      .element(page.getByRole('button', { name: 'Редактировать часы за 24 октября' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Удалить часы за 24 октября' }))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: /10 октября/ })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /15 октября/ })).not.toBeInTheDocument()
  })

  it('блокирует добавление часов, пока не задана ставка', async () => {
    data.value = { ...linked, hourlyRate: null }
    mountPage()
    await expect.element(addHours()).toBeDisabled()
    await expect.element(page.getByText(/Ставка ещё не задана/)).toBeVisible()
  })
})
