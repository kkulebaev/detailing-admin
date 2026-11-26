import { assert, describe, expect, it } from 'vitest'
import type { PricelistSection } from '@detailing-admin/shared'
import { emptyDraft, formatPay, parseDrafts, sortByPricelist } from '@/lib/work-rules'

const svc = (id: number, sectionId: number, name: string) => ({
  id,
  sectionId,
  name,
  description: null,
  countable: false,
  durationMinutes: null,
  priceClass1Min: 0,
  priceClass1Max: null,
  priceClass2Min: 0,
  priceClass2Max: null,
  priceClass3Min: 0,
  priceClass3Max: null,
  priceClass4Min: 0,
  priceClass4Max: null,
})

const sections: PricelistSection[] = [
  { id: 1, name: 'Химчистка', services: [svc(10, 1, 'Химчистка салона')] },
  { id: 2, name: 'Прочее', services: [svc(20, 2, 'Чернение шин'), svc(21, 2, 'Мойка')] },
]

describe('sortByPricelist', () => {
  it('ставит правила в порядке прайса, раздел перед своими услугами', () => {
    const rules = [
      { sectionId: null, serviceId: 21 },
      { sectionId: 2, serviceId: null },
      { sectionId: null, serviceId: 20 },
      { sectionId: 1, serviceId: null },
    ]
    expect(sortByPricelist(rules, sections)).toEqual([
      { sectionId: 1, serviceId: null },
      { sectionId: 2, serviceId: null },
      { sectionId: null, serviceId: 20 },
      { sectionId: null, serviceId: 21 },
    ])
  })
})

describe('formatPay', () => {
  it('процент, одинаковый фикс и диапазон фикса', () => {
    expect(formatPay({ sectionId: 1, serviceId: null, kind: 'percent', percent: 40 })).toBe('40 %')
    expect(
      formatPay({
        sectionId: 1,
        serviceId: null,
        kind: 'fixed',
        fixedByClass: [500, 500, 500, 500],
      }),
    ).toBe('500 ₽')
    expect(
      formatPay({
        sectionId: 1,
        serviceId: null,
        kind: 'fixed',
        fixedByClass: [800, 1000, 1200, 1500],
      }),
    ).toBe('800–1 500 ₽')
  })
})

describe('parseDrafts', () => {
  it('новое правило без процента — ошибка, а не молчаливый 0', () => {
    const d = emptyDraft({ sectionId: 1, serviceId: null })
    const r = parseDrafts([d])
    assert(!r.ok)
    expect(r.errors[d.key]).toBe('Укажите процент от 0 до 100')
  })

  it('процент больше 100 — ошибка', () => {
    const r = parseDrafts([{ ...emptyDraft({ sectionId: 1, serviceId: null }), percent: '101' }])
    expect(r.ok).toBe(false)
  })

  it('фикс требует все четыре суммы, 0 допустим', () => {
    const base = { ...emptyDraft({ sectionId: null, serviceId: 20 }), kind: 'fixed' as const }
    expect(parseDrafts([{ ...base, fixed: ['80', '', '120', '150'] }]).ok).toBe(false)
    const r = parseDrafts([{ ...base, fixed: ['0', '100', '120', '150'] }])
    assert(r.ok)
    expect(r.rules).toEqual([
      { sectionId: null, serviceId: 20, kind: 'fixed', fixedByClass: [0, 100, 120, 150] },
    ])
  })

  it('отбрасывает значения неактивного типа', () => {
    const d = {
      ...emptyDraft({ sectionId: 1, serviceId: null }),
      percent: '35',
      fixed: ['1', '2', '3', '4'],
    }
    const r = parseDrafts([d])
    assert(r.ok)
    expect(r.rules).toEqual([{ sectionId: 1, serviceId: null, kind: 'percent', percent: 35 }])
  })
})
