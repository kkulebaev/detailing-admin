// Per-service breakdown emitted by ServicePicker and projected into the sheet's
// «Услуга» cell at submit time. The picker's internal `modelValue` stays a plain
// name CSV (used to restore a draft), so this richer shape is a separate channel.

export interface ServiceBreakdownRow {
  sectionId: number
  section: string
  name: string
  // Цена за единицу услуги (для штучных умножается на `quantity`).
  price: number
  // Количество единиц. Для обычных услуг всегда 1; штучные могут быть > 1.
  quantity: number
}

// «Услуга» cell text: one line per pricelist section, its services grouped on
// that line. Prices are intentionally omitted from the sheet cell. Mirrors the
// picker's category-card layout, e.g.:
//   Химчистка: Потолок, Багажник
//   Тонировка: Задняя полусфера
// Штучные услуги с количеством > 1 показываются как «Название ×N».
export function formatServiceCell(rows: ServiceBreakdownRow[]): string {
  const bySection = new Map<number, { section: string; items: string[] }>()
  for (const row of rows) {
    let group = bySection.get(row.sectionId)
    if (!group) {
      group = { section: row.section, items: [] }
      bySection.set(row.sectionId, group)
    }
    const qty = row.quantity > 0 ? row.quantity : 1
    group.items.push(qty > 1 ? `${row.name} ×${qty}` : row.name)
  }
  return [...bySection.values()]
    .map((group) => `${group.section}: ${group.items.join(', ')}`)
    .join('\n')
}

// «Сумма» cell formula reconstructing how the total was reached, e.g.
// "=2000+3000-950" (services − discount) or "=1500*3+2000" (countable service).
// A manual override of «Сумма» away from the services subtotal is preserved as
// an extra signed term so the formula still evaluates to the saved amount, e.g.
// "=2000-500" when the operator lowered the total by 500 ₽.
//
// `baseAmount` is the «Сумма» value before the discount; `discount` is the
// discount in rubles (0 when none). Returns undefined when no services are
// selected — nothing to derive, caller should send the bare number instead.
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
