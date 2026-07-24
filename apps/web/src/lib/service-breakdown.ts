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

const priceFormatter = new Intl.NumberFormat('ru-RU')

// «Услуга» cell text: one line per pricelist section, its services (with the
// current, possibly hand-edited, price) grouped on that line. Mirrors the
// picker's category-card layout, e.g.:
//   Химчистка: Потолок — 2 000 ₽, Багажник — 2 000 ₽
//   Тонировка: Задняя полусфера — 7 500 ₽
// Штучные услуги с количеством > 1 показываются как «Название ×N — сумма ₽»,
// где сумма = цена за единицу × количество.
export function formatServiceCell(rows: ServiceBreakdownRow[]): string {
  const bySection = new Map<number, { section: string; items: string[] }>()
  for (const row of rows) {
    let group = bySection.get(row.sectionId)
    if (!group) {
      group = { section: row.section, items: [] }
      bySection.set(row.sectionId, group)
    }
    const qty = row.quantity > 0 ? row.quantity : 1
    const lineTotal = row.price * qty
    group.items.push(
      qty > 1
        ? `${row.name} ×${qty} — ${priceFormatter.format(lineTotal)} ₽`
        : `${row.name} — ${priceFormatter.format(row.price)} ₽`,
    )
  }
  return [...bySection.values()]
    .map((group) => `${group.section}: ${group.items.join(', ')}`)
    .join('\n')
}
