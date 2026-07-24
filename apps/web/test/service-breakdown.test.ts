import { describe, it, expect } from 'vitest'

import { formatServiceCell, type ServiceBreakdownRow } from '@/lib/service-breakdown'

// Intl.NumberFormat('ru-RU') groups thousands with a non-breaking space (U+00A0),
// so the expectations spell it out explicitly.
const NB = ' '

function row(
  sectionId: number,
  section: string,
  name: string,
  price: number,
  quantity = 1,
): ServiceBreakdownRow {
  return { sectionId, section, name, price, quantity }
}

describe('formatServiceCell', () => {
  it('returns an empty string for no rows', () => {
    expect(formatServiceCell([])).toBe('')
  })

  it('formats a single service with its thousands-grouped price', () => {
    expect(formatServiceCell([row(1, 'Химчистка', 'Потолок', 2000)])).toBe(
      `Химчистка: Потолок — 2${NB}000 ₽`,
    )
  })

  it('groups services of the same section on one comma-separated line', () => {
    expect(
      formatServiceCell([
        row(1, 'Химчистка', 'Потолок', 2000),
        row(1, 'Химчистка', 'Багажник', 3000),
      ]),
    ).toBe(`Химчистка: Потолок — 2${NB}000 ₽, Багажник — 3${NB}000 ₽`)
  })

  it('puts each section on its own line', () => {
    expect(
      formatServiceCell([
        row(1, 'Химчистка', 'Потолок', 2000),
        row(4, 'Тонировка', 'Задняя полусфера', 7500),
      ]),
    ).toBe(`Химчистка: Потолок — 2${NB}000 ₽\nТонировка: Задняя полусфера — 7${NB}500 ₽`)
  })

  it('keeps same-named services under their own section', () => {
    expect(
      formatServiceCell([
        row(2, 'Полировка', 'Крыша', 2000),
        row(7, 'Шумоизоляция', 'Крыша', 10000),
      ]),
    ).toBe(`Полировка: Крыша — 2${NB}000 ₽\nШумоизоляция: Крыша — 10${NB}000 ₽`)
  })

  it('renders a countable service as «×N — line total»', () => {
    expect(
      formatServiceCell([row(1, 'Химчистка', 'Сиденье перед.', 1500, 3)]),
    ).toBe(`Химчистка: Сиденье перед. ×3 — 4${NB}500 ₽`)
  })

  it('omits the ×N annotation when quantity is 1', () => {
    expect(
      formatServiceCell([row(1, 'Химчистка', 'Сиденье перед.', 1500, 1)]),
    ).toBe(`Химчистка: Сиденье перед. — 1${NB}500 ₽`)
  })

  it('mixes countable and plain services on one section line', () => {
    expect(
      formatServiceCell([
        row(1, 'Химчистка', 'Потолок', 2000),
        row(1, 'Химчистка', 'Сиденье перед.', 1500, 2),
      ]),
    ).toBe(`Химчистка: Потолок — 2${NB}000 ₽, Сиденье перед. ×2 — 3${NB}000 ₽`)
  })
})
