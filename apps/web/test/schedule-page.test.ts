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

vi.mock('@/lib/schedule-api', () => ({ saveSchedule: vi.fn() }))

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import SchedulePage from '@/components/SchedulePage.vue'
import { saveSchedule } from '@/lib/schedule-api'
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
const monthName = MONTHS[Number(month.slice(5)) - 1]
const dayLabel = (d: number) => `Иван, ${d} ${monthName}`
const secondDayLabel = dayLabel(2)

enableAutoUnmount(afterEach)

describe('SchedulePage', () => {
  beforeEach(() => {
    state.isAdmin.value = true
    state.from.value = monthScheduleRange(month).from
    state.schedule.value = [{ masterId: 1, dates: [`${month}-01`] }]
    vi.mocked(saveSchedule).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('отметки не уходят на сервер, пока админ не нажмет «Сохранить»', async () => {
    vi.mocked(saveSchedule).mockImplementation(async ({ days }) => {
      state.schedule.value = [{ masterId: 1, dates: [`${month}-02`] }]
      expect(days).toHaveLength(2)
      return { ok: true }
    })
    mount(SchedulePage, { attachTo: document.body })

    const first = page.getByRole('button', { name: dayLabel(1) })
    const second = page.getByRole('button', { name: secondDayLabel })
    await second.click()
    await first.click()
    await expect.element(second).toHaveAttribute('aria-pressed', 'true')
    await expect.element(first).toHaveAttribute('aria-pressed', 'false')
    expect(saveSchedule).not.toHaveBeenCalled()
    await expect.element(page.getByText('Несохраненных изменений: 2')).toBeInTheDocument()

    await page.getByRole('button', { name: 'Сохранить' }).click()

    expect(saveSchedule).toHaveBeenCalledWith({
      days: expect.arrayContaining([
        { masterId: 1, date: `${month}-02`, working: true },
        { masterId: 1, date: `${month}-01`, working: false },
      ]),
    })
    await expect.element(page.getByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
    await expect.element(second).toHaveAttribute('aria-pressed', 'true')
    await expect.element(first).toHaveAttribute('aria-pressed', 'false')
  })

  it('повторный тап возвращает день как был, и сохранять нечего', async () => {
    mount(SchedulePage, { attachTo: document.body })

    const second = page.getByRole('button', { name: secondDayLabel })
    await second.click()
    await expect.element(page.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()
    await second.click()

    await expect.element(second).toHaveAttribute('aria-pressed', 'false')
    await expect.element(page.getByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  })

  it('«Отменить» сбрасывает черновик', async () => {
    mount(SchedulePage, { attachTo: document.body })

    const second = page.getByRole('button', { name: secondDayLabel })
    await second.click()
    await page.getByRole('button', { name: 'Отменить' }).click()

    await expect.element(second).toHaveAttribute('aria-pressed', 'false')
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('при ошибке сохранения черновик остается', async () => {
    vi.mocked(saveSchedule).mockResolvedValue({ ok: false, error: 'internal' })
    mount(SchedulePage, { attachTo: document.body })

    const second = page.getByRole('button', { name: secondDayLabel })
    await second.click()
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    await expect.element(second).toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('двойной тап по «Сохранить» шлет один запрос', async () => {
    let release: (v: { ok: true }) => void = () => {}
    vi.mocked(saveSchedule).mockReturnValue(new Promise((r) => (release = r)))
    mount(SchedulePage, { attachTo: document.body })

    await page.getByRole('button', { name: secondDayLabel }).click()
    const save = page.getByRole('button', { name: 'Сохранить' })
    await save.click()
    await expect.element(page.getByRole('button', { name: 'Сохранение…' })).toBeDisabled()
    release({ ok: true })

    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('сотрудник видит график, но не может его менять', async () => {
    state.isAdmin.value = false
    mount(SchedulePage, { attachTo: document.body })

    await expect.element(page.getByText('Иван', { exact: true })).toBeInTheDocument()
    expect(page.getByRole('button', { name: /^Иван, / }).elements()).toHaveLength(0)
  })

  it('пока на экране прошлый месяц, отметки не видны и не ставятся', async () => {
    state.from.value = '1999-01-01'
    mount(SchedulePage, { attachTo: document.body })

    const first = page.getByRole('button', { name: secondDayLabel.replace(', 2 ', ', 1 ') })
    await expect.element(first).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: secondDayLabel }).click()

    expect(page.getByRole('button', { name: 'Сохранить' }).elements()).toHaveLength(0)
  })
})
