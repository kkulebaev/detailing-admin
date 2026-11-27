import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useDiscount } from '@/composables/use-discount'

describe('useDiscount', () => {
  it('рубли: не больше базы', () => {
    const base = ref(1000)
    const d = useDiscount(base)
    d.raw.value = '1 500'
    expect(d.amount.value).toBe(1000)
    expect(d.finalAmount.value).toBe(0)
  })

  it('проценты: округляет до рубля и ограничивает 100%', () => {
    const base = ref(999)
    const d = useDiscount(base)
    d.setUnit('pct')
    d.raw.value = '10'
    expect(d.amount.value).toBe(100)
    expect(d.noteLine()).toBe('Скидка 10%')
    d.raw.value = '150'
    expect(d.amount.value).toBe(999)
  })

  it('смена единиц перенормализует введенное значение', () => {
    const d = useDiscount(ref(100_000))
    d.raw.value = '2 500'
    d.setUnit('pct')
    expect(d.raw.value).toBe('100')
    d.setUnit('rub')
    expect(d.raw.value).toBe('100')
    d.raw.value = '2500'
    d.setUnit('pct')
    d.setUnit('rub')
    expect(d.raw.value).toBe('100')
  })

  it('строка для примечания в рублях и сброс', () => {
    const d = useDiscount(ref(10_000))
    expect(d.noteLine()).toBe('')
    d.raw.value = '1 500'
    expect(d.noteLine()).toBe('Скидка 1 500 ₽')
    d.reset()
    expect(d.hasDiscount.value).toBe(false)
    expect(d.unit.value).toBe('rub')
  })
})
