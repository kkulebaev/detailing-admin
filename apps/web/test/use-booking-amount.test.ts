import { describe, expect, it, vi } from 'vitest'
import { useBookingAmount } from '@/composables/use-booking-amount'

describe('useBookingAmount', () => {
  it('итог услуг заполняет сумму, ручная правка помечается и откатывается', () => {
    const setField = vi.fn()
    const a = useBookingAmount(setField)
    a.onServicesTotal(12_500)
    expect(a.amountRaw.value).toBe('12 500')
    expect(setField).toHaveBeenLastCalledWith(12_500)
    expect(a.amountOverridden.value).toBe(false)

    a.addAmount(1000)
    expect(a.amountRaw.value).toBe('13 500')
    expect(a.amountOverridden.value).toBe(true)
    expect(a.amountDeltaLabel.value).toBe('+1 000 ₽')

    a.resetAmountToServices()
    expect(a.amountRaw.value).toBe('12 500')
    expect(a.amountOverridden.value).toBe(false)
  })

  it('снятие всех услуг очищает сумму', () => {
    const setField = vi.fn()
    const a = useBookingAmount(setField)
    a.onServicesTotal(500)
    a.onServicesTotal(null)
    expect(a.amountRaw.value).toBe('')
    expect(setField).toHaveBeenLastCalledWith('')
  })

  it('восстановление черновика без цифр не трогает поле формы', () => {
    const setField = vi.fn()
    const a = useBookingAmount(setField)
    a.restore(' ')
    expect(setField).not.toHaveBeenCalled()
    a.restore('2 000')
    expect(setField).toHaveBeenCalledWith(2000)
  })
})
