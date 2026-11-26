import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { dates: ref<string[]>([]) }
})

vi.mock('@/lib/queries', async () => {
  const { computed, ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    CLOSED_DAYS_KEY: ['closed-days'],
    useStudioHoursQuery: () => ({ data: ref({ ok: true, days: [] }), error: ref(null) }),
    useClosedDaysQuery: () => ({
      data: computed(() => ({ ok: true, from: '', to: '', dates: state.dates.value })),
      error: ref(null),
    }),
  }
})
vi.mock('@/lib/schedule-api', () => ({ addClosedDays: vi.fn(), removeClosedDay: vi.fn() }))
vi.mock('@pinia/colada', () => ({
  useQueryCache: () => ({ invalidateQueries: () => Promise.resolve() }),
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import ClosedDaysDialog from '@/components/ClosedDaysDialog.vue'
import { addClosedDays, removeClosedDay } from '@/lib/schedule-api'

enableAutoUnmount(afterEach)

const TODAY = '2026-11-26'
// Календарь открывается на месяце `today` из пропса, а не системных часов.
function dayCell(day: number) {
  return page.getByRole('button', { name: `${day} ноября` })
}

function open() {
  return mount(ClosedDaysDialog, {
    attachTo: document.body,
    props: { open: true, today: TODAY },
  })
}

describe('ClosedDaysDialog', () => {
  beforeEach(() => {
    state.dates.value = []
    vi.mocked(addClosedDays).mockReset().mockResolvedValue({ ok: true })
    vi.mocked(removeClosedDay).mockReset().mockResolvedValue({ ok: true })
  })

  it('без выходных список не показывается', async () => {
    open()
    await expect.element(page.getByRole('button', { name: 'Добавить' })).toBeInTheDocument()
    expect(document.querySelector('[role="dialog"] ul')).toBeNull()
  })

  it('добавляет один день: клик по одной дате дважды', async () => {
    open()
    await dayCell(28).click()
    await dayCell(28).click()
    await page.getByRole('button', { name: 'Добавить' }).click()
    expect(addClosedDays).toHaveBeenCalledWith({ from: '2026-11-28', to: '2026-11-28' })
  })

  it('добавляет диапазон', async () => {
    open()
    await dayCell(28).click()
    await dayCell(29).click()
    await page.getByRole('button', { name: 'Добавить' }).click()
    expect(addClosedDays).toHaveBeenCalledWith({ from: '2026-11-28', to: '2026-11-29' })
  })

  it('уже добавленный выходной заштрихован', async () => {
    state.dates.value = ['2026-11-28']
    open()
    await expect
      .element(page.getByRole('button', { name: '28 ноября, выходной' }))
      .toHaveClass(/closed-hatch/)
  })

  it('не дает выбрать прошедший день', async () => {
    open()
    await expect.element(dayCell(25)).toBeDisabled()
  })

  it('сворачивает подряд идущие дни и удаляет все дни диапазона', async () => {
    state.dates.value = ['2026-12-31', '2027-01-01', '2027-01-02']
    open()
    await expect.element(page.getByText('31 декабря – 2 января')).toBeInTheDocument()
    await page.getByRole('button', { name: 'Удалить выходные: 31 декабря – 2 января' }).click()
    expect(removeClosedDay).toHaveBeenCalledTimes(3)
    expect(removeClosedDay).toHaveBeenCalledWith('2027-01-01')
  })

  it('показывает выходные с днем недели и удаляет их', async () => {
    state.dates.value = ['2026-12-31']
    open()
    await expect.element(page.getByText('31 декабря, чт')).toBeInTheDocument()
    await page.getByRole('button', { name: 'Удалить выходной: 31 декабря' }).click()
    expect(removeClosedDay).toHaveBeenCalledWith('2026-12-31')
  })
})
