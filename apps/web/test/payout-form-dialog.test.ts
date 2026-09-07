// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

// The direction toggle is the only thing standing between "premium" and "fine":
// a wrong branch there pays a bonus where a deduction was meant. These tests pin
// the toggle → sign mapping end to end, from the rendered control to the payload
// handed to the API wrapper.

const createPayoutMock = vi.fn()
const updatePayoutMock = vi.fn()

vi.mock('@/lib/salaries-api', () => ({
  createPayout: (...args: unknown[]) => createPayoutMock(...args),
  updatePayout: (...args: unknown[]) => updatePayoutMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import type { Payout } from '@detailing-admin/shared'
import PayoutFormDialog from '@/components/PayoutFormDialog.vue'

// Dialog and Popover content is teleported out of the component tree, so every
// lookup goes through `document`, never through the wrapper.
function buttonByText(text: string): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  if (!el) throw new Error(`Кнопка «${text}» не найдена`)
  return el
}

function dateTrigger(): HTMLButtonElement {
  const el = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('ДД.ММ.ГГГГ'),
  )
  if (!el) throw new Error('Кнопка выбора даты не найдена')
  return el
}

// Picks the 15th of the month the calendar opens on (today's), skipping the
// padding cells that belong to the neighbouring months.
async function pickDay15() {
  dateTrigger().click()
  await nextTick()
  await nextTick()
  const cell = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      'button[data-slot="calendar-cell-trigger"]:not([data-outside-view])',
    ),
  ).find((b) => b.textContent?.trim() === '15')
  if (!cell) throw new Error('Ячейка календаря 15-го числа не найдена')
  cell.click()
  await nextTick()
}

function expectedIsoDay15(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
}

async function typeAmount(value: string) {
  const input = document.querySelector<HTMLInputElement>('#payout-amount')
  if (!input) throw new Error('Поле суммы не найдено')
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function submitForm() {
  const form = document.querySelector('form')
  if (!form) throw new Error('Форма не найдена')
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}

function mountDialog(): VueWrapper {
  return mount(PayoutFormDialog, {
    attachTo: document.body,
    props: {
      open: true,
      editing: null,
      masterId: 7,
      masterName: 'Иван',
    },
  })
}

// The prefill watcher only fires on the open transition, which is how the page
// drives the dialog — mount it closed, then open it.
async function mountEditing(editing: Payout): Promise<VueWrapper> {
  const w = mount(PayoutFormDialog, {
    attachTo: document.body,
    props: { open: false, editing, masterId: 7, masterName: 'Иван' },
  })
  await w.setProps({ open: true })
  await nextTick()
  return w
}

function amountField(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('#payout-amount')
  if (!el) throw new Error('Поле суммы не найдено')
  return el
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  createPayoutMock.mockReset()
  createPayoutMock.mockResolvedValue({ ok: true, payout: {} })
  updatePayoutMock.mockReset()
  updatePayoutMock.mockResolvedValue({ ok: true, payout: {} })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

describe('PayoutFormDialog', () => {
  it('отправляет отрицательную сумму, когда выбрано «Удержание»', async () => {
    wrapper = mountDialog()
    await nextTick()

    await pickDay15()
    await typeAmount('2000')
    buttonByText('Удержание').click()
    await nextTick()

    await submitForm()

    expect(createPayoutMock).toHaveBeenCalledTimes(1)
    expect(createPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        masterId: 7,
        payoutDate: expectedIsoDay15(),
        amount: -2000,
      }),
    )
  })

  it('отправляет положительную сумму, когда выбрано «Начисление»', async () => {
    wrapper = mountDialog()
    await nextTick()

    await pickDay15()
    await typeAmount('2000')
    buttonByText('Начисление').click()
    await nextTick()

    await submitForm()

    expect(createPayoutMock).toHaveBeenCalledTimes(1)
    expect(createPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
    )
  })

  it('оставляет «Начисление» выбранным по умолчанию', async () => {
    wrapper = mountDialog()
    await nextTick()

    await pickDay15()
    await typeAmount('1500')
    await submitForm()

    expect(createPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1500 }),
    )
  })

  it('не теряет направление, когда активный переключатель нажали повторно', async () => {
    wrapper = mountDialog()
    await nextTick()

    await pickDay15()
    await typeAmount('2000')
    buttonByText('Удержание').click()
    await nextTick()
    // reka-ui снимает выбор кликом по активному элементу — направление должно
    // остаться прежним, а не уйти в пустое значение.
    buttonByText('Удержание').click()
    await nextTick()

    await submitForm()

    expect(createPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -2000 }),
    )
  })

  // Редактирование — самая длинная связка: watcher разбирает знак на
  // направление и модуль, submit собирает его обратно. Перепутанное сравнение
  // в watcher превратило бы удержание в премию, не уронив ни одного теста
  // создания.
  it('разбирает отрицательную сумму на «Удержание» + модуль и собирает её обратно', async () => {
    wrapper = await mountEditing({
      id: 9,
      masterId: 7,
      payoutDate: '2026-07-05',
      amount: -2000,
      note: '',
      createdAt: '2026-07-05T10:00:00.000Z',
    })

    expect(amountField().value).toBe('2000')
    expect(buttonByText('Удержание').getAttribute('data-state')).toBe('on')
    expect(buttonByText('Начисление').getAttribute('data-state')).toBe('off')

    await submitForm()

    expect(createPayoutMock).not.toHaveBeenCalled()
    expect(updatePayoutMock).toHaveBeenCalledTimes(1)
    expect(updatePayoutMock).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ payoutDate: '2026-07-05', amount: -2000 }),
    )
  })

  it('разбирает положительную сумму на «Начисление» + модуль', async () => {
    wrapper = await mountEditing({
      id: 9,
      masterId: 7,
      payoutDate: '2026-07-05',
      amount: 3500,
      note: '',
      createdAt: '2026-07-05T10:00:00.000Z',
    })

    expect(amountField().value).toBe('3500')
    expect(buttonByText('Начисление').getAttribute('data-state')).toBe('on')

    await submitForm()

    expect(updatePayoutMock).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ amount: 3500 }),
    )
  })

  it('не зовёт API, пока сумма пуста', async () => {
    wrapper = mountDialog()
    await nextTick()

    await pickDay15()
    await submitForm()

    expect(createPayoutMock).not.toHaveBeenCalled()
  })

  // The date is picked from a calendar, so the schema's format message would
  // name a format (ГГГГ-ММ-ДД) the user never types — the trigger shows
  // ДД.ММ.ГГГГ.
  it('просит указать дату, а не жалуется на её формат, пока дата не выбрана', async () => {
    wrapper = mountDialog()
    await nextTick()

    await typeAmount('4000')
    await submitForm()

    expect(createPayoutMock).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Укажите дату')
    expect(document.body.textContent).not.toContain('ГГГГ-ММ-ДД')
  })
})
