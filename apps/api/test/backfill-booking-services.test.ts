import { describe, it, expect, assert } from 'vitest'
import {
  parseBookingServices,
  type PricelistForParse,
} from '../scripts/backfill-booking-services.js'

const PRICELIST: PricelistForParse = {
  sections: [
    {
      name: 'Химчистка',
      services: [
        { id: 1, name: 'Потолок' },
        { id: 2, name: 'Сиденье' },
        { id: 3, name: 'Багажник' },
      ],
    },
    {
      name: 'Оклейка пленкой (NanoLink 190 мкм, Китай)',
      services: [
        { id: 10, name: 'Полоса на капот (40-50 см)' },
        { id: 11, name: 'Фары, фонари' },
        { id: 12, name: 'Фары' },
      ],
    },
    { name: 'Тонировка', services: [{ id: 20, name: 'Задняя полусфера' }] },
  ],
}

function parse(service: string, amountFormula: string | null, amount: number, note = '') {
  return parseBookingServices({ service, amountFormula, amount, note }, PRICELIST)
}

describe('parseBookingServices', () => {
  it('раскладывает услуги по слагаемым формулы в порядке ячейки', () => {
    const r = parse(
      'Химчистка: Потолок, Багажник\nТонировка: Задняя полусфера',
      '=2000+3000+8000',
      13000,
    )
    assert(r.ok)
    expect(r.discount).toBe(0)
    expect(r.lines).toEqual([
      { serviceId: 1, section: 'Химчистка', name: 'Потолок', price: 2000, quantity: 1 },
      { serviceId: 3, section: 'Химчистка', name: 'Багажник', price: 3000, quantity: 1 },
      { serviceId: 20, section: 'Тонировка', name: 'Задняя полусфера', price: 8000, quantity: 1 },
    ])
  })

  it('берет количество из «×N» и сверяет его со слагаемым «цена*N»', () => {
    const r = parse('Химчистка: Сиденье ×4', '=1500*4', 6000)
    assert(r.ok)
    expect(r.lines[0]).toMatchObject({ serviceId: 2, price: 1500, quantity: 4 })
    expect(parse('Химчистка: Сиденье ×4', '=1500*3', 4500)).toEqual({
      ok: false,
      reason: 'term_mismatch',
    })
  })

  it('не режет названия разделов и услуг с запятыми', () => {
    const r = parse(
      'Оклейка пленкой (NanoLink 190 мкм, Китай): Полоса на капот (40-50 см), Фары, фонари',
      '=10000+6000',
      16000,
    )
    assert(r.ok)
    expect(r.lines.map((l) => l.serviceId)).toEqual([10, 11])
  })

  it('отказывается, если ячейку можно прочесть двумя способами', () => {
    // «x, y» читается и как одна услуга «x, y», и как две — «x» и «y».
    const pl: PricelistForParse = {
      sections: [
        {
          name: 'А',
          services: [
            { id: 1, name: 'x, y' },
            { id: 2, name: 'x' },
            { id: 3, name: 'y' },
          ],
        },
      ],
    }
    const r = parseBookingServices(
      { service: 'А: x, y', amountFormula: '=1+2', amount: 3, note: '' },
      pl,
    )
    expect(r).toEqual({ ok: false, reason: 'ambiguous_service' })
  })

  it('принимает ручную поправку суммы без скидки', () => {
    const r = parse('Химчистка: Потолок', '=2000-500', 1500)
    assert(r.ok)
    expect(r.lines[0].price).toBe(2000)
    expect(r.discount).toBe(0)
  })

  it('отличает скидку от поправки по строке «Скидка» в примечании', () => {
    const rub = parse('Химчистка: Потолок', '=2000-500', 1500, 'Позвонить\nСкидка 500 ₽')
    assert(rub.ok)
    expect(rub.discount).toBe(500)

    const both = parse('Химчистка: Потолок', '=2000+1000-300', 2700, 'Скидка 10%')
    assert(both.ok)
    expect(both.discount).toBe(300)
  })

  it('отказывается, если скидка из формулы не сходится с примечанием', () => {
    expect(parse('Химчистка: Потолок', '=2000-500', 1500, 'Скидка 10%')).toEqual({
      ok: false,
      reason: 'discount_mismatch',
    })
    expect(parse('Химчистка: Потолок', '=2000', 2000, 'Скидка 1 000 ₽')).toEqual({
      ok: false,
      reason: 'discount_mismatch',
    })
  })

  it('отказывается, если формула не дает сохраненную сумму', () => {
    expect(parse('Химчистка: Потолок', '=2000', 2500)).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    })
  })

  it('пропускает записи без формулы и с текстом вместо формулы', () => {
    expect(parse('Химчистка: Потолок', null, 2000)).toEqual({ ok: false, reason: 'no_formula' })
    expect(parse('Химчистка салона', '14-20', 2000)).toEqual({ ok: false, reason: 'bad_formula' })
    expect(parse('Химчистка: Потолок', '=SUM(1)', 1)).toEqual({ ok: false, reason: 'bad_formula' })
  })

  it('оставляет переименованную услугу без связи с прайсом, если слагаемые сходятся', () => {
    const r = parse(
      'Химчистка: Комплексная химчистка\nТонировка: Задняя полусфера',
      '=14000+8000',
      22000,
    )
    assert(r.ok)
    expect(r.lines[0]).toEqual({
      serviceId: null,
      section: 'Химчистка',
      name: 'Комплексная химчистка',
      price: 14000,
      quantity: 1,
    })
    expect(r.lines[1].serviceId).toBe(20)
  })

  it('не доверяет разбивке переименованного раздела, если слагаемых больше, чем услуг', () => {
    // Лишнее слагаемое может быть и поправкой, и частью названия с запятой.
    expect(parse('Оклейка: Фары, фонари', '=6000+2000+1000', 9000)).toEqual({
      ok: false,
      reason: 'term_mismatch',
    })
  })

  it('отказывается, если услуги раздела идут не в порядке прайса', () => {
    // Так форма не писала: текст переставили руками, а формула осталась прежней.
    expect(parse('Химчистка: Багажник, Потолок', '=3000+2000', 5000)).toEqual({
      ok: false,
      reason: 'order_mismatch',
    })
  })

  it('отказывается от строки, которую не пропустит схема записи', () => {
    expect(parse('Химчистка: Потолок', '=100000000', 100000000)).toEqual({
      ok: false,
      reason: 'invalid_line',
    })
  })
})
