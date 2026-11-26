import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import type { StudioDay } from '@detailing-admin/shared'

vi.mock('@/lib/schedule-api', () => ({ saveStudioHours: vi.fn() }))
vi.mock('@pinia/colada', () => ({
  useQueryCache: () => ({ invalidateQueries: () => Promise.resolve() }),
}))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import StudioHoursDialog from '@/components/StudioHoursDialog.vue'
import { saveStudioHours } from '@/lib/schedule-api'

enableAutoUnmount(afterEach)
afterEach(() => vi.mocked(saveStudioHours).mockReset())

function open(days: StudioDay[]) {
  return mount(StudioHoursDialog, { attachTo: document.body, props: { open: true, days } })
}

describe('StudioHoursDialog', () => {
  it('показывает сохраненный режим и отправляет только рабочие дни', async () => {
    vi.mocked(saveStudioHours).mockResolvedValue({ ok: true, days: [] })
    const wrapper = open([{ weekday: 0, opensAt: '09:00', closesAt: '21:00' }])

    await expect.element(page.getByRole('switch', { name: 'Понедельник' })).toBeChecked()
    await expect.element(page.getByLabelText('Понедельник: открытие')).toHaveValue('09:00')

    // Включенный день берет часы рабочего дня выше.
    await page.getByRole('switch', { name: 'Вторник' }).click()
    await expect.element(page.getByLabelText('Вторник: закрытие')).toHaveValue('21:00')

    await page.getByRole('button', { name: 'Сохранить' }).click()

    expect(saveStudioHours).toHaveBeenCalledWith({
      days: [
        { weekday: 0, opensAt: '09:00', closesAt: '21:00' },
        { weekday: 1, opensAt: '09:00', closesAt: '21:00' },
      ],
    })
    await expect.poll(() => wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('не сохраняет неделю без рабочих дней', async () => {
    open([{ weekday: 0, opensAt: '09:00', closesAt: '21:00' }])

    await page.getByRole('switch', { name: 'Понедельник' }).click()
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect.element(page.getByText('Отметьте хотя бы один рабочий день')).toBeInTheDocument()
    expect(saveStudioHours).not.toHaveBeenCalled()
  })

  it('не сохраняет день, который закрывается раньше открытия', async () => {
    open([{ weekday: 2, opensAt: '09:00', closesAt: '21:00' }])

    await page.getByLabelText('Среда: закрытие').fill('08:00')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect.element(page.getByText('Закрытие должно быть позже открытия')).toBeInTheDocument()
    expect(saveStudioHours).not.toHaveBeenCalled()
  })
})
