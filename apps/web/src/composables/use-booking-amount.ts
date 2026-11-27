import { computed, ref } from 'vue'
import { groupThousands, maskThousands } from '@/lib/number-mask'
import { formatAmount } from '@/lib/money'
import { amountDigits, writeMasked } from '@/lib/input-masks'

export const AMOUNT_PRESETS = [1000, 5000, 10000, 50000] as const

// «Сумма» формы записи: отображаемое значение с разделителями тысяч и сверка с итогом
// по услугам из пикера. В поле формы число уходит через `setField`.
export function useBookingAmount(setField: (value: number | '') => void) {
  const amountRaw = ref('')
  // Последняя сумма цен услуг из пикера (null, если ничего не выбрано).
  // Хранится, чтобы «Сумма» могла пометить, что ее вручную увели от этого итога.
  const servicesTotal = ref<number | null>(null)

  const baseAmount = computed(() => {
    const digits = amountDigits(amountRaw.value)
    return digits === '' ? 0 : parseInt(digits, 10)
  })

  // Разница со знаком между «Сумма» и итогом по услугам (текущая − итог).
  // null, когда сравнивать не с чем. Пустая сумма считается за 0.
  const amountDelta = computed<number | null>(() =>
    servicesTotal.value === null ? null : baseAmount.value - servicesTotal.value,
  )

  // True, когда услуги выбраны, а «Сумма» уже не равна их итогу — т. е. оператор
  // ввел свое значение (или воспользовался +пресетом).
  const amountOverridden = computed(() => amountDelta.value !== null && amountDelta.value !== 0)

  // «+2 500 ₽» / «−2 000 ₽» — насколько ручная сумма отличается от итога по услугам.
  const amountDeltaLabel = computed(() => {
    const d = amountDelta.value ?? 0
    const sign = d > 0 ? '+' : '−'
    return `${sign}${formatAmount(Math.abs(d))} ₽`
  })

  function setAmount(value: number) {
    amountRaw.value = groupThousands(String(value))
    setField(value)
  }

  function resetAmountToServices() {
    if (servicesTotal.value === null) return
    setAmount(servicesTotal.value)
  }

  function onAmountInput(e: Event) {
    const target = e.target
    if (!(target instanceof HTMLInputElement)) return
    const caretPos = target.selectionStart ?? target.value.length
    const { value, caret } = maskThousands(target.value, caretPos)
    if (writeMasked(target, value, caret)) amountRaw.value = value
    const digits = amountDigits(value)
    setField(digits === '' ? '' : parseInt(digits, 10))
  }

  function addAmount(delta: number) {
    setAmount(baseAmount.value + delta)
  }

  // Автозаполнение «Сумма» по ценам услуг из пикера. Поле остается
  // редактируемым — ручное значение просто держится до следующего изменения
  // выбора/цены, которое пересчитает итог.
  function onServicesTotal(total: number | null) {
    servicesTotal.value = total
    if (total === null) {
      amountRaw.value = ''
      setField('')
      return
    }
    setAmount(total)
  }

  // Восстановление черновика: поле формы получает число, только если в тексте есть цифры.
  function restore(raw: string) {
    amountRaw.value = raw
    const digits = amountDigits(raw)
    if (digits) setField(parseInt(digits, 10))
  }

  function reset() {
    amountRaw.value = ''
    servicesTotal.value = null
  }

  return {
    amountRaw,
    baseAmount,
    amountOverridden,
    amountDeltaLabel,
    setAmount,
    resetAmountToServices,
    onAmountInput,
    addAmount,
    onServicesTotal,
    restore,
    reset,
  }
}

export type BookingAmount = ReturnType<typeof useBookingAmount>
