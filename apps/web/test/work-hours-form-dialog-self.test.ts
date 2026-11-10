import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { calendarDay } from './helpers/calendar'

// В self-режиме диалог должен ходить через /api/me и никогда не указывать мастера:
// сервер берет мастера из сессии, поэтому masterId в payload в лучшем случае
// проигнорируется, а в худшем — намекнет, что клиент может его выбирать.

const createWorkHoursMock = vi.fn()
const createMyWorkHoursMock = vi.fn()

vi.mock('@/lib/salaries-api', () => ({
  createWorkHours: (...args: unknown[]) => createWorkHoursMock(...args),
  updateWorkHours: vi.fn(),
}))

vi.mock('@/lib/me-api', () => ({
  createMyWorkHours: (...args: unknown[]) => createMyWorkHoursMock(...args),
  updateMyWorkHours: vi.fn(),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import WorkHoursFormDialog from '@/components/WorkHoursFormDialog.vue'

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const WINDOW = { editableFrom: `${ym}-10`, editableTo: `${ym}-20` }

const button = (name: string) => page.getByRole('button', { name })

function mountDialog() {
  mount(WorkHoursFormDialog, {
    attachTo: document.body,
    props: { open: true, editing: null, masterId: 4, masterName: 'Петр', self: WINDOW },
  })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  createWorkHoursMock.mockReset()
  createMyWorkHoursMock.mockReset()
  createMyWorkHoursMock.mockResolvedValue({ ok: true, hours: { masterId: 4 } })
})

describe('WorkHoursFormDialog — self-режим', () => {
  it('создает запись через /api/me без masterId', async () => {
    mountDialog()

    await button('ДД.ММ.ГГГГ').click()
    await calendarDay(15).click()
    await page.getByLabelText('Часы').fill('7.5')
    await button('Добавить').click()

    await vi.waitFor(() =>
      expect(createMyWorkHoursMock).toHaveBeenCalledWith({
        workDate: `${ym}-15`,
        hours: 7.5,
        note: '',
      }),
    )
    expect(createWorkHoursMock).not.toHaveBeenCalled()
  })

  it('блокирует дни календаря вне окна редактирования', async () => {
    mountDialog()

    await button('ДД.ММ.ГГГГ').click()

    await expect.element(calendarDay(9)).toHaveAttribute('aria-disabled', 'true')
    await expect.element(calendarDay(21)).toHaveAttribute('aria-disabled', 'true')
    await expect.element(calendarDay(15)).not.toHaveAttribute('aria-disabled')
  })
})
