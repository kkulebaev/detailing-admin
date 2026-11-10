import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { calendarDay } from './helpers/calendar'

// Переключатель направления — единственное, что отделяет «премию» от «штрафа»:
// ошибочная ветка там выплатит бонус вместо удержания. Эти тесты закрепляют
// соответствие переключатель → знак от начала до конца, от отрисованного контрола
// до payload, переданного в обертку API.

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

const button = (name: string) => page.getByRole('button', { name })
const amountField = () => page.getByLabelText('Сумма ₽')

async function pickDay15() {
  await button('ДД.ММ.ГГГГ').click()
  await calendarDay(15).click()
}

function expectedIsoDay15(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
}

function mountDialog() {
  mount(PayoutFormDialog, {
    attachTo: document.body,
    props: {
      open: true,
      editing: null,
      masterId: 7,
      masterName: 'Иван',
    },
  })
}

// Watcher предзаполнения срабатывает только на переходе к открытию — именно так
// диалогом управляет страница: монтируем закрытым, затем открываем.
async function mountEditing(editing: Payout) {
  const w = mount(PayoutFormDialog, {
    attachTo: document.body,
    props: { open: false, editing, masterId: 7, masterName: 'Иван' },
  })
  await w.setProps({ open: true })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  createPayoutMock.mockReset()
  createPayoutMock.mockResolvedValue({ ok: true, payout: {} })
  updatePayoutMock.mockReset()
  updatePayoutMock.mockResolvedValue({ ok: true, payout: {} })
})

describe('PayoutFormDialog', () => {
  it('отправляет отрицательную сумму, когда выбрано «Удержание»', async () => {
    mountDialog()

    await pickDay15()
    await amountField().fill('2000')
    await button('Удержание').click()
    await button('Добавить').click()

    await vi.waitFor(() => expect(createPayoutMock).toHaveBeenCalledTimes(1))
    expect(createPayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        masterId: 7,
        payoutDate: expectedIsoDay15(),
        amount: -2000,
      }),
    )
  })

  it('отправляет положительную сумму, когда выбрано «Начисление»', async () => {
    mountDialog()

    await pickDay15()
    await amountField().fill('2000')
    await button('Начисление').click()
    await button('Добавить').click()

    await vi.waitFor(() => expect(createPayoutMock).toHaveBeenCalledTimes(1))
    expect(createPayoutMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 2000 }))
  })

  it('оставляет «Начисление» выбранным по умолчанию', async () => {
    mountDialog()

    await pickDay15()
    await amountField().fill('1500')
    await button('Добавить').click()

    await vi.waitFor(() =>
      expect(createPayoutMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 1500 })),
    )
  })

  it('не теряет направление, когда активный переключатель нажали повторно', async () => {
    mountDialog()

    await pickDay15()
    await amountField().fill('2000')
    await button('Удержание').click()
    // reka-ui снимает выбор кликом по активному элементу — направление должно
    // остаться прежним, а не уйти в пустое значение.
    await button('Удержание').click()
    await button('Добавить').click()

    await vi.waitFor(() =>
      expect(createPayoutMock).toHaveBeenCalledWith(expect.objectContaining({ amount: -2000 })),
    )
  })

  // Редактирование — самая длинная связка: watcher разбирает знак на
  // направление и модуль, submit собирает его обратно. Перепутанное сравнение
  // в watcher превратило бы удержание в премию, не уронив ни одного теста
  // создания.
  it('разбирает отрицательную сумму на «Удержание» + модуль и собирает ее обратно', async () => {
    await mountEditing({
      id: 9,
      masterId: 7,
      payoutDate: '2026-07-05',
      amount: -2000,
      note: '',
      createdAt: '2026-07-05T10:00:00.000Z',
    })

    await expect.element(amountField()).toHaveValue(2000)
    await expect.element(button('Удержание')).toHaveAttribute('aria-pressed', 'true')
    await expect.element(button('Начисление')).toHaveAttribute('aria-pressed', 'false')

    await button('Сохранить').click()

    await vi.waitFor(() => expect(updatePayoutMock).toHaveBeenCalledTimes(1))
    expect(createPayoutMock).not.toHaveBeenCalled()
    expect(updatePayoutMock).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ payoutDate: '2026-07-05', amount: -2000 }),
    )
  })

  it('разбирает положительную сумму на «Начисление» + модуль', async () => {
    await mountEditing({
      id: 9,
      masterId: 7,
      payoutDate: '2026-07-05',
      amount: 3500,
      note: '',
      createdAt: '2026-07-05T10:00:00.000Z',
    })

    await expect.element(amountField()).toHaveValue(3500)
    await expect.element(button('Начисление')).toHaveAttribute('aria-pressed', 'true')

    await button('Сохранить').click()

    await vi.waitFor(() =>
      expect(updatePayoutMock).toHaveBeenCalledWith(9, expect.objectContaining({ amount: 3500 })),
    )
  })

  it('не зовет API, пока сумма пуста', async () => {
    mountDialog()

    await pickDay15()
    await button('Добавить').click()

    await expect.element(page.getByText('Укажите сумму больше нуля')).toBeVisible()
    expect(createPayoutMock).not.toHaveBeenCalled()
  })

  // Дата выбирается из календаря, поэтому сообщение схемы о формате назвало бы
  // формат (ГГГГ-ММ-ДД), который пользователь никогда не вводит, — триггер
  // показывает ДД.ММ.ГГГГ.
  it('просит указать дату, а не жалуется на ее формат, пока дата не выбрана', async () => {
    mountDialog()

    await amountField().fill('4000')
    await button('Добавить').click()

    await expect.element(page.getByText('Укажите дату')).toBeVisible()
    await expect.element(page.getByText(/ГГГГ-ММ-ДД/)).not.toBeInTheDocument()
    expect(createPayoutMock).not.toHaveBeenCalled()
  })
})
