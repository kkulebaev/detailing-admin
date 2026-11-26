import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { PricelistSection, PricelistService } from '@detailing-admin/shared'

const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('@/lib/pricelist-api', () => ({
  createService: (...args: unknown[]) => createMock(...args),
  updateService: (...args: unknown[]) => updateMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import ServiceFormDialog from '@/components/ServiceFormDialog.vue'

const service: PricelistService = {
  id: 7,
  sectionId: 1,
  name: 'Полировка',
  description: null,
  countable: false,
  durationMinutes: 120,
  priceClass1Min: 1000,
  priceClass1Max: null,
  priceClass2Min: 1000,
  priceClass2Max: null,
  priceClass3Min: 1000,
  priceClass3Max: null,
  priceClass4Min: 1000,
  priceClass4Max: null,
}

const sections: PricelistSection[] = [{ id: 1, name: 'Полировка', services: [service] }]

async function openWith(svc: PricelistService | null) {
  const w = mount(ServiceFormDialog, {
    attachTo: document.body,
    props: { open: false, service: svc, defaultSectionId: 1, sections },
  })
  await w.setProps({ open: true })
  return w
}

async function fillPrices() {
  for (const n of [1, 2, 3, 4]) {
    await page.getByLabelText(`${['I', 'II', 'III', 'IV'][n - 1]} кл.`).fill('500')
  }
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  createMock.mockReset()
  createMock.mockResolvedValue({ ok: true, service })
  updateMock.mockReset()
  updateMock.mockResolvedValue({ ok: true, service })
})

describe('ServiceFormDialog: время работ', () => {
  it('переводит часы в durationMinutes', async () => {
    await openWith(null)
    await page.getByLabelText('Название').fill('Мойка')
    await fillPrices()
    await page.getByLabelText('Время работ, ч').fill('3')
    await page.getByRole('button', { name: 'Добавить' }).click()

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({ durationMinutes: 180 })
  })

  it('пустые поля отправляют null', async () => {
    await openWith(null)
    await page.getByLabelText('Название').fill('Мойка')
    await fillPrices()
    await page.getByRole('button', { name: 'Добавить' }).click()

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({ durationMinutes: null })
  })

  it('показывает сохраненное время в часах и не принимает дробные часы', async () => {
    await openWith(service)
    await expect.element(page.getByLabelText('Время работ, ч')).toHaveValue('2')

    await page.getByLabelText('Время работ, ч').fill('1,5')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect.element(page.getByText('Целое число часов')).toBeInTheDocument()
    expect(updateMock).not.toHaveBeenCalled()
  })
})
