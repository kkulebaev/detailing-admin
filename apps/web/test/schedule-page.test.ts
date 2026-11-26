import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { Master, ScheduleRequest } from '@detailing-admin/shared'
import { monthScheduleRange } from '@detailing-admin/shared'
import { buildMonthOptions, currentMonthKey } from '@/lib/month-options'
import { createTestRouter } from './helpers/router'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    isAdmin: ref(true),
    schedule: ref<{ masterId: number; dates: string[] }[]>([]),
    // Диапазон, к которому относится ответ: прошлый месяц имитирует placeholderData.
    from: ref(''),
    // Ответ /api/me/schedule-requests; null — запрос не нужен (админ).
    my: ref<{
      ok: true
      masterId: number | null
      today: string
      requests: ScheduleRequest[]
    } | null>(null),
    pending: ref<ScheduleRequest[]>([]),
    studioDays: ref<{ weekday: number; opensAt: string; closesAt: string }[]>([]),
  }
})

const masters: Master[] = [
  {
    id: 1,
    name: 'Иван',
    position: 0,
    canBeResponsible: true,
    paidSalary: true,
    userId: null,
  },
]

vi.mock('@/lib/queries', async () => {
  const { computed, ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    SCHEDULE_KEY: ['schedule'],
    SCHEDULE_REQUESTS_KEY: ['schedule-requests'],
    MY_SCHEDULE_REQUESTS_KEY: ['my-schedule-requests'],
    useMyScheduleRequestsQuery: () => ({ data: computed(() => state.my.value ?? undefined) }),
    usePendingScheduleRequestsQuery: () => ({
      data: computed(() => ({ ok: true, requests: state.pending.value })),
    }),
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
    STUDIO_HOURS_KEY: ['studio-hours'],
    useStudioHoursQuery: () => ({
      data: computed(() => ({ ok: true, days: state.studioDays.value })),
      error: ref(null),
    }),
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

vi.mock('vue-router', async () => ({
  ...(await vi.importActual<typeof import('vue-router')>('vue-router')),
  onBeforeRouteLeave: vi.fn(),
}))

vi.mock('@/lib/schedule-requests-api', () => ({
  submitScheduleRequest: vi.fn(),
  withdrawScheduleRequest: vi.fn(),
  approveScheduleRequest: vi.fn(),
  rejectScheduleRequest: vi.fn(),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import SchedulePage from '@/components/SchedulePage.vue'
import { saveSchedule } from '@/lib/schedule-api'
import {
  approveScheduleRequest,
  rejectScheduleRequest,
  submitScheduleRequest,
} from '@/lib/schedule-requests-api'
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
    state.my.value = null
    state.pending.value = []
    state.studioDays.value = []
    vi.mocked(saveSchedule).mockReset()
    vi.mocked(submitScheduleRequest).mockReset()
    vi.mocked(approveScheduleRequest).mockReset()
    vi.mocked(rejectScheduleRequest).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('дни, когда студия закрыта, заштрихованы и подписаны', async () => {
    const [y, m] = month.split('-').map(Number)
    const closedWeekday = (new Date(Date.UTC(y!, m! - 1, 2)).getUTCDay() + 6) % 7
    state.studioDays.value = [0, 1, 2, 3, 4, 5, 6]
      .filter((w) => w !== closedWeekday)
      .map((weekday) => ({ weekday, opensAt: '10:00', closesAt: '20:00' }))
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    const closed = page.getByRole('button', { name: `${secondDayLabel}, студия закрыта` })
    await expect.element(closed).toHaveClass(/closed-hatch/)
    // Поставить рабочий день в выходной студии нельзя.
    await expect.element(closed).toBeDisabled()
    await expect
      .element(page.getByRole('button', { name: dayLabel(3) }))
      .not.toHaveClass(/closed-hatch/)
    await expect.element(page.getByText('Студия закрыта', { exact: true })).toBeInTheDocument()
  })

  it('день, отмеченный до смены режима, в выходной студии можно снять', async () => {
    const [y, m] = month.split('-').map(Number)
    const closedWeekday = (new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay() + 6) % 7
    state.studioDays.value = [0, 1, 2, 3, 4, 5, 6]
      .filter((w) => w !== closedWeekday)
      .map((weekday) => ({ weekday, opensAt: '10:00', closesAt: '20:00' }))
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    const first = page.getByRole('button', { name: `${dayLabel(1)}, студия закрыта` })
    await expect.element(first).toHaveAttribute('aria-pressed', 'true')
    await first.click()
    await expect.element(first).toHaveAttribute('aria-pressed', 'false')
    await expect.element(first).toBeDisabled()
  })

  it('«Весь месяц» не отмечает выходные студии', async () => {
    const [y, m] = month.split('-').map(Number)
    const closedWeekday = (new Date(Date.UTC(y!, m! - 1, 2)).getUTCDay() + 6) % 7
    state.studioDays.value = [0, 1, 2, 3, 4, 5, 6]
      .filter((w) => w !== closedWeekday)
      .map((weekday) => ({ weekday, opensAt: '10:00', closesAt: '20:00' }))
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    await page.getByRole('button', { name: 'Иван: отметить весь месяц' }).click()

    await expect
      .element(page.getByRole('button', { name: `${secondDayLabel}, студия закрыта` }))
      .toHaveAttribute('aria-pressed', 'false')
    await expect
      .element(page.getByRole('button', { name: dayLabel(3) }))
      .toHaveAttribute('aria-pressed', 'true')
    // Все дни, когда студия работает, отмечены — кнопка предлагает снять месяц.
    await expect
      .element(page.getByRole('button', { name: 'Иван: снять весь месяц' }))
      .toBeInTheDocument()
  })

  it('без заданного режима ничего не штрихуется', async () => {
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    await expect
      .element(page.getByRole('button', { name: secondDayLabel }))
      .not.toHaveClass(/closed-hatch/)
    await expect.element(page.getByText('Студия закрыта', { exact: true })).not.toBeInTheDocument()
  })

  it('отметки не уходят на сервер, пока админ не нажмет «Сохранить»', async () => {
    vi.mocked(saveSchedule).mockImplementation(async ({ days }) => {
      state.schedule.value = [{ masterId: 1, dates: [`${month}-02`] }]
      expect(days).toHaveLength(2)
      return { ok: true }
    })
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

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

  describe('месяц в адресе', () => {
    const next = buildMonthOptions(1, 0)[0]!
    const current = buildMonthOptions(0, 0)[0]!

    async function mountAt(path: string) {
      const router = await createTestRouter(path)
      mount(SchedulePage, { attachTo: document.body, global: { plugins: [router] } })
      return router
    }

    it('открывает месяц из query', async () => {
      await mountAt(`/?month=${next.value}`)

      await expect.element(page.getByRole('combobox')).toHaveTextContent(next.label)
    })

    it('незнакомый месяц заменяется текущим и пропадает из адреса', async () => {
      const router = await mountAt('/?month=1999-01')

      await expect.element(page.getByRole('combobox')).toHaveTextContent(current.label)
      await expect.poll(() => router.currentRoute.value.query.month).toBeUndefined()
    })

    it('выбранный месяц пишется в query, а текущий убирается из него', async () => {
      const router = await mountAt('/?keep=1')

      await page.getByRole('combobox').click()
      await page.getByRole('option', { name: next.label }).click()
      await expect.poll(() => router.currentRoute.value.query.month).toBe(next.value)

      await page.getByRole('combobox').click()
      await page.getByRole('option', { name: current.label }).click()
      await expect.poll(() => router.currentRoute.value.query.month).toBeUndefined()
      expect(router.currentRoute.value.query.keep).toBe('1')
    })

    it('адрес без месяца возвращает к текущему и не теряет черновик', async () => {
      const router = await mountAt('/')
      const second = page.getByRole('button', { name: secondDayLabel })
      await second.click()

      await router.push(`/?month=${next.value}`)
      await expect.element(page.getByRole('combobox')).toHaveTextContent(next.label)
      await router.push('/')

      await expect.element(page.getByRole('combobox')).toHaveTextContent(current.label)
      await expect.element(second).toHaveAttribute('aria-pressed', 'true')
      await expect.element(page.getByText('Несохраненных изменений: 1')).toBeInTheDocument()
    })
  })

  it('повторный тап возвращает день как был, и сохранять нечего', async () => {
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    const second = page.getByRole('button', { name: secondDayLabel })
    await second.click()
    await expect.element(page.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()
    await second.click()

    await expect.element(second).toHaveAttribute('aria-pressed', 'false')
    await expect.element(page.getByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  })

  it('«Отменить» сбрасывает черновик', async () => {
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    const second = page.getByRole('button', { name: secondDayLabel })
    await second.click()
    await page.getByRole('button', { name: 'Отменить' }).click()

    await expect.element(second).toHaveAttribute('aria-pressed', 'false')
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('при ошибке сохранения черновик остается', async () => {
    vi.mocked(saveSchedule).mockResolvedValue({ ok: false, error: 'internal' })
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

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
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    await page.getByRole('button', { name: secondDayLabel }).click()
    const save = page.getByRole('button', { name: 'Сохранить' })
    await save.click()
    await expect.element(page.getByRole('button', { name: 'Сохранение…' })).toBeDisabled()
    release({ ok: true })

    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('«Весь месяц» отмечает все дни мастера, повторное нажатие снимает их', async () => {
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y!, m!, 0).getDate()
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    await page.getByRole('button', { name: 'Иван: отметить весь месяц' }).click()

    await expect
      .element(page.getByRole('button', { name: dayLabel(daysInMonth) }))
      .toHaveAttribute('aria-pressed', 'true')
    // Первое число уже рабочее на сервере, поэтому в черновик оно не попадает.
    await expect
      .element(page.getByText(`Несохраненных изменений: ${daysInMonth - 1}`))
      .toBeInTheDocument()

    await page.getByRole('button', { name: 'Иван: снять весь месяц' }).click()

    await expect
      .element(page.getByRole('button', { name: dayLabel(1) }))
      .toHaveAttribute('aria-pressed', 'false')
    await expect.element(page.getByText('Несохраненных изменений: 1')).toBeInTheDocument()
  })

  it('сотрудник видит график, но не может его менять', async () => {
    state.isAdmin.value = false
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    await expect.element(page.getByText('Иван', { exact: true })).toBeInTheDocument()
    expect(page.getByRole('button', { name: /^Иван, / }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: /весь месяц/ }).elements()).toHaveLength(0)
  })

  it('пока на экране прошлый месяц, отметки не видны и не ставятся', async () => {
    state.from.value = '1999-01-01'
    mount(SchedulePage, {
      attachTo: document.body,
      global: { plugins: [await createTestRouter()] },
    })

    const first = page.getByRole('button', { name: secondDayLabel.replace(', 2 ', ', 1 ') })
    await expect.element(first).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: secondDayLabel }).click()

    expect(page.getByRole('button', { name: 'Сохранить' }).elements()).toHaveLength(0)
  })

  describe('заявки сотрудника', () => {
    const today = `${month}-15`
    const futureLabel = dayLabel(20)
    const pastLabel = dayLabel(10)

    beforeEach(() => {
      state.isAdmin.value = false
      state.my.value = { ok: true, masterId: 1, today, requests: [] }
    })

    it('сотрудник отмечает свои дни, в том числе прошедшие, и отправляет заявку', async () => {
      vi.mocked(submitScheduleRequest).mockResolvedValue({
        ok: true,
        request: {} as ScheduleRequest,
      })
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      const past = page.getByRole('button', { name: pastLabel })
      const future = page.getByRole('button', { name: futureLabel })
      await past.click()
      await future.click()
      await expect.element(past).toHaveAttribute('aria-pressed', 'true')
      await expect.element(future).toHaveAttribute('aria-pressed', 'true')

      await page.getByRole('button', { name: 'Отправить на согласование' }).click()

      expect(submitScheduleRequest).toHaveBeenCalledWith({
        days: [
          { date: `${month}-10`, working: true },
          { date: `${month}-20`, working: true },
        ],
      })
      expect(saveSchedule).not.toHaveBeenCalled()
    })

    it('пока заявка на согласовании, новую не собрать, а просьба видна в графике', async () => {
      state.my.value = {
        ok: true,
        masterId: 1,
        today,
        requests: [
          {
            id: 3,
            masterId: 1,
            masterName: 'Иван',
            status: 'pending',
            days: [{ date: `${month}-20`, working: true }],
            comment: null,
            createdAt: '2026-11-20T08:00:00.000Z',
            decidedAt: null,
            decidedByName: null,
          },
        ],
      }
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await expect.element(page.getByText('Заявка на согласовании')).toBeInTheDocument()
      await expect
        .element(page.getByRole('img', { name: `${futureLabel}: рабочий` }))
        .toBeInTheDocument()
      expect(page.getByRole('button', { name: /^Иван, / }).elements()).toHaveLength(0)
    })

    it('без привязки к мастеру отмечать нечего', async () => {
      state.my.value = { ok: true, masterId: null, today, requests: [] }
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await expect.element(page.getByText('Иван', { exact: true })).toBeInTheDocument()
      expect(page.getByRole('button', { name: /^Иван, / }).elements()).toHaveLength(0)
      expect(page.getByText('Вы', { exact: true }).elements()).toHaveLength(0)
    })

    it('свой мастер выделен в таблице', async () => {
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await expect.element(page.getByText('Вы', { exact: true })).toBeInTheDocument()
    })
  })

  describe('согласование админом', () => {
    const request: ScheduleRequest = {
      id: 3,
      masterId: 1,
      masterName: 'Иван',
      status: 'pending',
      days: [
        { date: `${month}-20`, working: true },
        { date: `${month}-21`, working: false },
      ],
      comment: null,
      createdAt: '2026-11-20T08:00:00.000Z',
      decidedAt: null,
      decidedByName: null,
    }

    beforeEach(() => {
      state.pending.value = [request]
    })

    it('админ, привязанный к мастеру, тоже видит себя в таблице', async () => {
      state.my.value = { ok: true, masterId: 1, today: `${month}-15`, requests: [] }
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await expect.element(page.getByText('Вы', { exact: true })).toBeInTheDocument()
      expect(page.getByText('Заявка на согласовании').elements()).toHaveLength(0)
    })

    it('админ видит заявку и одобряет ее', async () => {
      vi.mocked(approveScheduleRequest).mockResolvedValue({ ok: true })
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await expect
        .element(page.getByText(new RegExp(`Рабочие:\\s*20 ${monthName}`)))
        .toBeInTheDocument()
      await page.getByRole('button', { name: 'Одобрить заявку: Иван' }).click()

      expect(approveScheduleRequest).toHaveBeenCalledWith(3)
    })

    it('предпросмотр показывает заявку поверх графика мастера, из него можно одобрить', async () => {
      vi.mocked(approveScheduleRequest).mockResolvedValue({ ok: true })
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await page.getByRole('button', { name: 'Предпросмотр заявки: Иван' }).click()

      await expect
        .element(page.getByRole('img', { name: `1 ${monthName}: рабочий` }))
        .toBeInTheDocument()
      await expect
        .element(page.getByRole('img', { name: `20 ${monthName}: станет рабочий` }))
        .toBeInTheDocument()
      await expect
        .element(
          page.getByRole('img', { name: `21 ${monthName}: выходной, по заявке без изменений` }),
        )
        .toBeInTheDocument()
      await expect
        .element(page.getByText(/Рабочих дней в месяце/))
        .toHaveTextContent('Рабочих дней в месяце: 1 2')
      await expect.element(page.getByLabelText('станет')).toBeInTheDocument()

      await page.getByRole('button', { name: 'Одобрить', exact: true }).click()

      expect(approveScheduleRequest).toHaveBeenCalledWith(3)
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    })

    it('в предпросмотре дни, когда студия закрыта, заштрихованы', async () => {
      const [y, m] = month.split('-').map(Number)
      const closedWeekday = (new Date(Date.UTC(y!, m! - 1, 22)).getUTCDay() + 6) % 7
      state.studioDays.value = [0, 1, 2, 3, 4, 5, 6]
        .filter((w) => w !== closedWeekday)
        .map((weekday) => ({ weekday, opensAt: '10:00', closesAt: '20:00' }))
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await page.getByRole('button', { name: 'Предпросмотр заявки: Иван' }).click()

      const dialog = page.getByRole('dialog')
      await expect
        .element(dialog.getByRole('img', { name: `22 ${monthName}: выходной, студия закрыта` }))
        .toHaveClass(/closed-hatch/)
      await expect
        .element(dialog.getByRole('img', { name: `23 ${monthName}: выходной` }))
        .not.toHaveClass(/closed-hatch/)
      await expect.element(dialog.getByText('Студия закрыта', { exact: true })).toBeInTheDocument()
    })

    it('заявку с рабочим днем в выходной студии одобрить нельзя', async () => {
      const [y, m] = month.split('-').map(Number)
      const closedWeekday = (new Date(Date.UTC(y!, m! - 1, 20)).getUTCDay() + 6) % 7
      state.studioDays.value = [0, 1, 2, 3, 4, 5, 6]
        .filter((w) => w !== closedWeekday)
        .map((weekday) => ({ weekday, opensAt: '10:00', closesAt: '20:00' }))
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await page.getByRole('button', { name: 'Предпросмотр заявки: Иван' }).click()

      const dialog = page.getByRole('dialog')
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent(
          `Заявка просит рабочие дни, когда студия закрыта: 20 ${monthName}. Одобрить ее нельзя, только отклонить.`,
        )
      await expect
        .element(dialog.getByRole('button', { name: 'Одобрить', exact: true }))
        .toBeDisabled()
    })

    it('админ отклоняет заявку с комментарием', async () => {
      vi.mocked(rejectScheduleRequest).mockResolvedValue({ ok: true })
      mount(SchedulePage, {
        attachTo: document.body,
        global: { plugins: [await createTestRouter()] },
      })

      await page.getByRole('button', { name: 'Отклонить заявку: Иван' }).click()
      await page.getByLabelText(/Комментарий/).fill('Нет замены')
      await page.getByRole('button', { name: 'Отклонить', exact: true }).click()

      expect(rejectScheduleRequest).toHaveBeenCalledWith(3, { comment: 'Нет замены' })
    })
  })
})
