import { computed, ref, type Ref } from 'vue'
import { groupThousands, maskThousands } from '@/lib/number-mask'
import { formatAmount } from '@/lib/money'
import { writeMasked } from '@/lib/input-masks'

export type DiscountUnit = 'rub' | 'pct'

// Скидка (₽ или %) поверх базовой суммы. Чисто UI-помощник: отдельной колонки в
// таблице нет, поэтому при отправке форма пишет итог со скидкой, а саму скидку —
// строкой в примечание (`noteLine`).
export function useDiscount(baseAmount: Ref<number>) {
  const raw = ref('')
  const unit = ref<DiscountUnit>('rub')

  // Скидка в рублях, ограниченная так, чтобы не превышать базу (% не больше 100).
  // Процентная скидка округляется до ближайшего рубля.
  const amount = computed(() => {
    const digits = raw.value.replace(/\D/g, '')
    if (digits === '') return 0
    const n = parseInt(digits, 10)
    if (unit.value === 'pct') return Math.round((baseAmount.value * Math.min(n, 100)) / 100)
    return Math.min(n, baseAmount.value)
  })
  const finalAmount = computed(() => Math.max(0, baseAmount.value - amount.value))
  const hasDiscount = computed(() => amount.value > 0)

  function onInput(e: Event) {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    if (unit.value === 'pct') {
      let digits = target.value.replace(/\D/g, '').slice(0, 3)
      if (digits !== '' && parseInt(digits, 10) > 100) digits = '100'
      writeMasked(target, digits)
      raw.value = digits
      return
    }
    const caretPos = target.selectionStart ?? target.value.length
    const { value, caret } = maskThousands(target.value, caretPos, 8)
    writeMasked(target, value, caret)
    raw.value = value
  }

  // Перенормализуем сырое значение при смене единиц: для % убираем группировку и
  // ограничиваем 100; для ₽ заново группируем разделителями тысяч.
  function setUnit(next: DiscountUnit) {
    if (next === unit.value) return
    unit.value = next
    const digits = raw.value.replace(/\D/g, '')
    if (digits === '') return
    raw.value =
      next === 'pct' ? String(Math.min(parseInt(digits, 10), 100)) : groupThousands(digits)
  }

  // Рубли, вычисленные из процентной скидки, намеренно не пишутся: сохраняется только
  // сам размер скидки.
  function noteLine(): string {
    if (!hasDiscount.value) return ''
    if (unit.value === 'pct') {
      const pct = Math.min(parseInt(raw.value.replace(/\D/g, '') || '0', 10), 100)
      return `Скидка ${pct}%`
    }
    return `Скидка ${formatAmount(amount.value)} ₽`
  }

  function reset() {
    raw.value = ''
    unit.value = 'rub'
  }

  return { raw, unit, amount, finalAmount, hasDiscount, onInput, setUnit, noteLine, reset }
}
