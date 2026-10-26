// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { MySalaryOk } from '@detailing-admin/shared'

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  const data = ref<MySalaryOk | undefined>(undefined)
  return {
    useMySalaryQuery: () => ({ data, error: ref(null), asyncStatus: ref('idle') }),
    useInvalidateMySalary: () => vi.fn(),
    __data: data,
  }
})

vi.mock('@/lib/me-api', () => ({ deleteMyWorkHours: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import MyHoursPage from '@/pages/MyHoursPage.vue'
import * as queriesMock from '@/lib/queries'

const data = (queriesMock as unknown as { __data: { value: MySalaryOk | undefined } }).__data

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
    global: { stubs: { WorkHoursFormDialog: true } },
  })
}

describe('MyHoursPage', () => {
  beforeEach(() => {
    data.value = undefined
  })

  it('explains an unlinked account instead of showing zeros', async () => {
    data.value = { ...linked, master: null, entries: [], hourlyRate: null }
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('Аккаунт не привязан к мастеру')
    expect(w.text()).not.toContain('Добавить часы')
  })

  it('shows the month totals', async () => {
    data.value = linked
    const w = mountPage()
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Пётр')
    expect(text).toContain('4 800 ₽')
    expect(text).toContain('−500 ₽')
    expect(text).toContain('4 300 ₽')
    expect(text).toContain('Вычет')
  })

  it('offers edit and delete only for hours inside the window', async () => {
    data.value = linked
    const w = mountPage()
    await flushPromises()
    const labels = w.findAll('button[aria-label]').map((b) => b.attributes('aria-label'))
    expect(labels).toContain('Редактировать часы за 24 октября')
    expect(labels).toContain('Удалить часы за 24 октября')
    expect(labels.some((l) => l?.includes('10 октября'))).toBe(false)
    expect(labels.some((l) => l?.includes('15 октября'))).toBe(false)
  })

  it('disables adding hours until a rate is set', async () => {
    data.value = { ...linked, hourlyRate: null }
    const w = mountPage()
    await flushPromises()
    const add = w.findAll('button').find((b) => b.text().includes('Добавить часы'))
    expect(add?.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Ставка ещё не задана')
  })
})
