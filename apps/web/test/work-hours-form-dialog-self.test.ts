// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

// In self mode the dialog must go through /api/me and never name a master: the
// server takes the master from the session, so a masterId in the payload would
// at best be ignored and at worst hint that the client can choose it.

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

// Dialog and Popover content is teleported, so lookups go through `document`.
function dateTrigger(): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('ДД.ММ.ГГГГ'),
  )
  if (!el) throw new Error('Кнопка выбора даты не найдена')
  return el
}

async function openCalendar() {
  dateTrigger().click()
  await nextTick()
  await nextTick()
}

function dayCell(day: string): HTMLButtonElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      'button[data-slot="calendar-cell-trigger"]:not([data-outside-view])',
    ),
  ).find((b) => b.textContent?.trim() === day)
}

async function typeHours(value: string) {
  const input = document.querySelector<HTMLInputElement>('#work-hours')
  if (!input) throw new Error('Поле часов не найдено')
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function submitForm() {
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  createWorkHoursMock.mockReset()
  createMyWorkHoursMock.mockReset()
  createMyWorkHoursMock.mockResolvedValue({ ok: true, hours: { masterId: 4 } })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('WorkHoursFormDialog — self mode', () => {
  it('creates through /api/me without a masterId', async () => {
    wrapper = mount(WorkHoursFormDialog, {
      attachTo: document.body,
      props: { open: true, editing: null, masterId: 4, masterName: 'Пётр', self: WINDOW },
    })
    await nextTick()

    await openCalendar()
    dayCell('15')!.click()
    await nextTick()
    await typeHours('7.5')
    await submitForm()

    expect(createWorkHoursMock).not.toHaveBeenCalled()
    expect(createMyWorkHoursMock).toHaveBeenCalledWith({
      workDate: `${ym}-15`,
      hours: 7.5,
      note: '',
    })
  })

  it('disables calendar days outside the edit window', async () => {
    wrapper = mount(WorkHoursFormDialog, {
      attachTo: document.body,
      props: { open: true, editing: null, masterId: 4, masterName: 'Пётр', self: WINDOW },
    })
    await nextTick()

    await openCalendar()
    expect(dayCell('9')?.hasAttribute('data-disabled')).toBe(true)
    expect(dayCell('21')?.hasAttribute('data-disabled')).toBe(true)
    expect(dayCell('15')?.hasAttribute('data-disabled')).toBe(false)
  })
})
