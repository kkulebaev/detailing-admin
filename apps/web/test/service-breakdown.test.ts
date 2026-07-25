import { describe, it, expect } from 'vitest'

import {
  formatServiceCell,
  formatAmountFormula,
  type ServiceBreakdownRow,
} from '@/lib/service-breakdown'

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

  it('formats a single service without its price', () => {
    expect(formatServiceCell([row(1, 'Химчистка', 'Потолок', 2000)])).toBe(
      'Химчистка: Потолок',
    )
  })

  it('groups services of the same section on one comma-separated line', () => {
    expect(
      formatServiceCell([
        row(1, 'Химчистка', 'Потолок', 2000),
        row(1, 'Химчистка', 'Багажник', 3000),
      ]),
    ).toBe('Химчистка: Потолок, Багажник')
  })

  it('puts each section on its own line', () => {
    expect(
      formatServiceCell([
        row(1, 'Химчистка', 'Потолок', 2000),
        row(4, 'Тонировка', 'Задняя полусфера', 7500),
      ]),
    ).toBe('Химчистка: Потолок\nТонировка: Задняя полусфера')
  })

  it('keeps same-named services under their own section', () => {
    expect(
      formatServiceCell([
        row(2, 'Полировка', 'Крыша', 2000),
        row(7, 'Шумоизоляция', 'Крыша', 10000),
      ]),
    ).toBe('Полировка: Крыша\nШумоизоляция: Крыша')
  })

  it('renders a countable service as «×N» without a price', () => {
    expect(
      formatServiceCell([row(1, 'Химчистка', 'Сиденье перед.', 1500, 3)]),
    ).toBe('Химчистка: Сиденье перед. ×3')
  })

  it('omits the ×N annotation when quantity is 1', () => {
    expect(
      formatServiceCell([row(1, 'Химчистка', 'Сиденье перед.', 1500, 1)]),
    ).toBe('Химчистка: Сиденье перед.')
  })

  it('mixes countable and plain services on one section line', () => {
    expect(
      formatServiceCell([
        row(1, 'Химчистка', 'Потолок', 2000),
        row(1, 'Химчистка', 'Сиденье перед.', 1500, 2),
      ]),
    ).toBe('Химчистка: Потолок, Сиденье перед. ×2')
  })
})

describe('formatAmountFormula', () => {
  it('returns undefined when no services are selected', () => {
    expect(formatAmountFormula([], 5000, 0)).toBeUndefined()
  })

  it('sums service line totals with no discount and no override', () => {
    expect(
      formatAmountFormula(
        [row(1, 'Химчистка', 'Потолок', 2000), row(1, 'Химчистка', 'Багажник', 3000)],
        5000,
        0,
      ),
    ).toBe('=2000+3000')
  })

  it('expands a countable service as price*quantity', () => {
    expect(formatAmountFormula([row(1, 'Химчистка', 'Сиденье', 1500, 3)], 4500, 0)).toBe(
      '=1500*3',
    )
  })

  it('subtracts the discount as a trailing term', () => {
    expect(
      formatAmountFormula(
        [row(1, 'Химчистка', 'Потолок', 2000), row(1, 'Химчистка', 'Багажник', 3000)],
        5000,
        950,
      ),
    ).toBe('=2000+3000-950')
  })

  it('appends a positive override delta when the base exceeds the subtotal', () => {
    expect(formatAmountFormula([row(1, 'Химчистка', 'Потолок', 2000)], 2500, 0)).toBe(
      '=2000+500',
    )
  })

  it('appends a negative override delta when the base is below the subtotal', () => {
    expect(formatAmountFormula([row(1, 'Химчистка', 'Потолок', 2000)], 1500, 0)).toBe(
      '=2000-500',
    )
  })

  it('combines an override delta and a discount, evaluating to the saved amount', () => {
    // base 5500 (subtotal 5000 + 500 override) − 550 discount = 4950
    expect(
      formatAmountFormula(
        [row(1, 'Химчистка', 'Потолок', 2000), row(1, 'Химчистка', 'Багажник', 3000)],
        5500,
        550,
      ),
    ).toBe('=2000+3000+500-550')
  })
})
