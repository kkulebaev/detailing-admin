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
