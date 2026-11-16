import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { Master } from '@detailing-admin/shared'
import { monthScheduleRange } from '@detailing-admin/shared'
import { currentMonthKey } from '@/lib/month-options'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    isAdmin: ref(true),
    schedule: ref<{ masterId: number; dates: string[] }[]>([]),
    // Диапазон, к которому относится ответ: прошлый месяц имитирует placeholderData.
    from: ref(''),
  }
})

const masters: Master[] = [
  {
    id: 1,
    name: 'Иван',
    position: 0,
    canBeResponsible: true,
    paidSalary: true,
    telegramId: null,
    userId: null,
  },
]

vi.mock('@/lib/queries', async () => {
  const { computed, ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    SCHEDULE_KEY: ['schedule'],
    useScheduleQuery: () => ({
      data: computed(() => ({
        ok: true,
        from: state.from.value,
        to: '',
        schedule: state.schedule.value,
      })),
      error: ref(null),
      asyncStatus: ref('idle'),
    }),
    useMastersQuery: () => ({ data: ref({ ok: true, masters }), error: ref(null) }),
  }
})

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get isAdmin() {
      return state.isAdmin.value
    },
  }),
}))

vi.mock('@pinia/colada', () => ({
  useQueryCache: () => ({ invalidateQueries: () => Promise.resolve() }),
}))

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return { ...actual, useMediaQuery: () => ref(true) }
})

vi.mock('@/lib/schedule-api', () => ({ setScheduleDay: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import SchedulePage from '@/components/SchedulePage.vue'
import { setScheduleDay } from '@/lib/schedule-api'
import { toast } from 'vue-sonner'

const month = currentMonthKey()
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
const secondDayLabel = `Иван, 2 ${MONTHS[Number(month.slice(5)) - 1]}`

enableAutoUnmount(afterEach)

describe('SchedulePage', () => {
  beforeEach(() => {
    state.isAdmin.value = true
    state.from.value = monthScheduleRange(month).from
    state.schedule.value = [{ masterId: 1, dates: [`${month}-01`] }]
    vi.mocked(setScheduleDay).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('админ отмечает день рабочим', async () => {
    vi.mocked(setScheduleDay).mockImplementation(async ({ date }) => {
      state.schedule.value = [{ masterId: 1, dates: [`${month}-01`, date] }]
      return { ok: true }
    })
    mount(SchedulePage, { attachTo: document.body })

    const cell = page.getByRole('button', { name: secondDayLabel })
    await expect.element(cell).toHaveAttribute('aria-pressed', 'false')
    await cell.click()

    expect(setScheduleDay).toHaveBeenCalledWith({
      masterId: 1,
      date: `${month}-02`,
      working: true,
    })
    await expect.element(cell).toHaveAttribute('aria-pressed', 'true')
  })

  it('при ошибке сохранения отметка откатывается', async () => {
    vi.mocked(setScheduleDay).mockResolvedValue({ ok: false, error: 'internal' })
    mount(SchedulePage, { attachTo: document.body })

    const cell = page.getByRole('button', { name: secondDayLabel })
    await cell.click()

    await expect.element(cell).toHaveAttribute('aria-pressed', 'false')
    expect(toast.error).toHaveBeenCalled()
  })

  it('сотрудник видит график, но не может его менять', async () => {
    state.isAdmin.value = false
    mount(SchedulePage, { attachTo: document.body })

    await expect.element(page.getByText('Иван', { exact: true })).toBeInTheDocument()
    expect(page.getByRole('button', { name: /^Иван, / }).elements()).toHaveLength(0)
  })

  it('двойной тап по дню, пока идет сохранение, шлет один запрос', async () => {
    let release: (v: { ok: true }) => void = () => {}
    vi.mocked(setScheduleDay).mockReturnValue(new Promise((r) => (release = r)))
    mount(SchedulePage, { attachTo: document.body })

    const cell = page.getByRole('button', { name: secondDayLabel })
    await cell.click()
    await cell.click()
    release({ ok: true })

    expect(setScheduleDay).toHaveBeenCalledTimes(1)
  })

  it('пока на экране прошлый месяц, отметки не видны и не ставятся', async () => {
    state.from.value = '1999-01-01'
    mount(SchedulePage, { attachTo: document.body })

    const first = page.getByRole('button', { name: secondDayLabel.replace(', 2 ', ', 1 ') })
    await expect.element(first).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: secondDayLabel }).click()

    expect(setScheduleDay).not.toHaveBeenCalled()
  })
})
