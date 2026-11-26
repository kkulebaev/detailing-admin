import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { Master, PricelistSection, WorkRule } from '@detailing-admin/shared'

const saveMock = vi.fn()

vi.mock('@/lib/work-rules-api', () => ({
  saveMasterWorkRules: (...args: unknown[]) => saveMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import MasterWorkRulesDialog from '@/components/MasterWorkRulesDialog.vue'

const svc = (id: number, sectionId: number, name: string) => ({
  id,
  sectionId,
  name,
  description: null,
  countable: false,
  durationMinutes: null,
  priceClass1Min: 0,
  priceClass1Max: null,
  priceClass2Min: 0,
  priceClass2Max: null,
  priceClass3Min: 0,
  priceClass3Max: null,
  priceClass4Min: 0,
  priceClass4Max: null,
})

const sections: PricelistSection[] = [
  { id: 1, name: 'Химчистка', services: [svc(10, 1, 'Химчистка салона')] },
  { id: 2, name: 'Прочее', services: [svc(20, 2, 'Чернение шин')] },
]

const master: Master = {
  id: 5,
  name: 'Елизавета',
  position: 0,
  canBeResponsible: true,
  paidSalary: true,
  userId: null,
}

// Черновик заполняется при переходе к открытию — так диалогом управляет страница.
async function openWith(
  rules: WorkRule[],
  copySources: { id: number; name: string; rules: WorkRule[] }[] = [],
) {
  const w = mount(MasterWorkRulesDialog, {
    attachTo: document.body,
    props: { open: false, master, rules, sections, copySources },
  })
  await w.setProps({ open: true })
  return w
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  saveMock.mockReset()
  saveMock.mockResolvedValue({ ok: true, rules: [] })
})

describe('MasterWorkRulesDialog', () => {
  it('добавляет услугу с фиксом по классам и отправляет все четыре суммы', async () => {
    await openWith([])

    await page.getByRole('button', { name: 'Раздел или услуга' }).click()
    await page.getByRole('option', { name: 'Чернение шин' }).click()
    await page.getByLabelText('Фикс: Чернение шин').click()
    for (const [label, value] of [
      ['I', '80'],
      ['II', '100'],
      ['III', '120'],
      ['IV', '150'],
    ] as const) {
      await page.getByLabelText(`Фикс ${label} класс для Чернение шин`).fill(value)
    }
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith(5, [
      { sectionId: null, serviceId: 20, kind: 'fixed', fixedByClass: [80, 100, 120, 150] },
    ])
  })

  it('не сохраняет правило без процента', async () => {
    await openWith([])

    await page.getByRole('button', { name: 'Раздел или услуга' }).click()
    await page.getByRole('option', { name: 'Химчистка салона' }).click()
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect.element(page.getByText('Укажите процент от 0 до 100')).toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('убранный вид работ уходит из списка при сохранении', async () => {
    await openWith([
      { sectionId: 1, serviceId: null, kind: 'percent', percent: 40 },
      { sectionId: null, serviceId: 20, kind: 'percent', percent: 30 },
    ])

    await expect.element(page.getByLabelText('Процент для Химчистка')).toHaveValue('40')
    await page.getByRole('button', { name: 'Убрать Химчистка' }).click()
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith(5, [
      { sectionId: null, serviceId: 20, kind: 'percent', percent: 30 },
    ])
  })

  it('показывает ошибку сервера у той строки, на которую указывает путь', async () => {
    saveMock.mockResolvedValue({
      ok: false,
      error: 'validation',
      issues: [{ path: ['rules', 1, 'serviceId'], message: 'Раздела или услуги уже нет в прайсе' }],
    })
    await openWith([
      { sectionId: null, serviceId: 20, kind: 'percent', percent: 30 },
      { sectionId: 1, serviceId: null, kind: 'percent', percent: 40 },
    ])

    await page.getByRole('button', { name: 'Сохранить' }).click()

    // Отправка идет в порядке прайса: Химчистка [0], Чернение шин [1].
    const row = page.getByRole('group', { name: 'Чернение шин' })
    await expect.element(row.getByText('Раздела или услуги уже нет в прайсе')).toBeInTheDocument()
  })

  it('копирует правила другого мастера вместо текущих, сохраняя только по кнопке', async () => {
    const ivanRules: WorkRule[] = [
      { sectionId: 2, serviceId: null, kind: 'percent', percent: 35 },
      { sectionId: null, serviceId: 10, kind: 'fixed', fixedByClass: [1, 2, 3, 4] },
    ]
    await openWith(
      [{ sectionId: 1, serviceId: null, kind: 'percent', percent: 40 }],
      [{ id: 8, name: 'Иван', rules: ivanRules }],
    )

    await page.getByRole('button', { name: 'Скопировать у мастера' }).click()
    await page.getByRole('menuitem', { name: /Иван/ }).click()

    await expect.element(page.getByLabelText('Процент для Прочее')).toHaveValue('35')
    await expect.element(page.getByLabelText('Процент для Химчистка')).not.toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'Сохранить' }).click()
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith(5, [
      { sectionId: null, serviceId: 10, kind: 'fixed', fixedByClass: [1, 2, 3, 4] },
      { sectionId: 2, serviceId: null, kind: 'percent', percent: 35 },
    ])
  })

  it('без других мастеров с правилами кнопки копирования нет', async () => {
    await openWith([])
    await expect
      .element(page.getByRole('button', { name: 'Скопировать у мастера' }))
      .not.toBeInTheDocument()
  })
})
