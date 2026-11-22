// Разбивка по услугам, которую отдает ServicePicker и которая при отправке проецируется
// в ячейку «Услуга» листа. Внутренний `modelValue` пикера остается простым CSV
// из названий (по нему восстанавливается черновик), поэтому эта более богатая форма —
// отдельный канал.

import type { BookingServiceLine } from '@detailing-admin/shared'

// Совпадает со строкой услуги записи: разбивка уходит в `services` как есть.
// `price` — цена за единицу (у штучных умножается на `quantity`); `serviceId` равен
// null у строки, которой уже нет в прайсе (она пришла из сохраненной записи).
export type ServiceBreakdownRow = BookingServiceLine

// Текст ячейки «Услуга»: по строке на каждый раздел прайслиста, услуги сгруппированы
// в этой строке. Цены в ячейку листа намеренно не попадают. Повторяет
// раскладку карточек категорий в пикере, например:
//   Химчистка: Потолок, Багажник
//   Тонировка: Задняя полусфера
// Штучные услуги с количеством > 1 показываются как «Название ×N».
export function formatServiceCell(rows: ServiceBreakdownRow[]): string {
  // Ключ — название раздела: у строки не из прайса id раздела нет, а названия
  // разделов уникальны.
  const bySection = new Map<string, { section: string; items: string[] }>()
  for (const row of rows) {
    let group = bySection.get(row.section)
    if (!group) {
      group = { section: row.section, items: [] }
      bySection.set(row.section, group)
    }
    const qty = row.quantity > 0 ? row.quantity : 1
    group.items.push(qty > 1 ? `${row.name} ×${qty}` : row.name)
  }
  return [...bySection.values()]
    .map((group) => `${group.section}: ${group.items.join(', ')}`)
    .join('\n')
}

// Формула ячейки «Сумма», показывающая, как получен итог, например
// "=2000+3000-950" (услуги − скидка) или "=1500*3+2000" (штучная услуга).
// Ручная правка «Суммы» в сторону от подытога по услугам сохраняется
// отдельным слагаемым со знаком, чтобы формула все равно давала сохраненную сумму, например
// "=2000-500", когда оператор снизил итог на 500 ₽.
//
// `baseAmount` — значение «Суммы» до скидки; `discount` — скидка
// в рублях (0, если ее нет). Возвращает undefined, если не выбрано ни одной услуги:
// выводить нечего, вызывающий код должен отправить просто число.
export function formatAmountFormula(
  rows: ServiceBreakdownRow[],
  baseAmount: number,
  discount: number,
): string | undefined {
  if (rows.length === 0) return undefined
  const terms: string[] = []
  let subtotal = 0
  for (const row of rows) {
    const qty = row.quantity > 0 ? row.quantity : 1
    subtotal += row.price * qty
    terms.push(qty > 1 ? `${row.price}*${qty}` : String(row.price))
  }
  let formula = terms.join('+')
  const delta = baseAmount - subtotal
  if (delta !== 0) formula += delta > 0 ? `+${delta}` : `-${-delta}`
  if (discount > 0) formula += `-${discount}`
  return `=${formula}`
}
