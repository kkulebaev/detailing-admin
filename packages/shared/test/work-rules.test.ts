import { assert, describe, expect, it } from 'vitest'
import { workRulesInputSchema } from '../src/work-rules.js'

const percent = (over: Record<string, unknown> = {}) => ({
  sectionId: 1,
  serviceId: null,
  kind: 'percent',
  percent: 40,
  ...over,
})

describe('workRulesInputSchema', () => {
  it('принимает процент на раздел и фикс на услугу', () => {
    const r = workRulesInputSchema.safeParse({
      rules: [
        percent(),
        { sectionId: null, serviceId: 7, kind: 'fixed', fixedByClass: [80, 100, 120, 0] },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('отклоняет правило без цели и с двумя целями', () => {
    for (const target of [
      { sectionId: null, serviceId: null },
      { sectionId: 1, serviceId: 7 },
    ]) {
      const r = workRulesInputSchema.safeParse({ rules: [percent(target)] })
      assert(!r.success)
      expect(r.error.issues[0]?.path).toEqual(['rules', 0, 'sectionId'])
    }
  })

  it('отклоняет повтор одной цели', () => {
    const r = workRulesInputSchema.safeParse({ rules: [percent(), percent({ percent: 30 })] })
    assert(!r.success)
    expect(r.error.issues[0]?.path).toEqual(['rules', 1, 'sectionId'])
  })

  it('не путает раздел и услугу с одинаковым id', () => {
    const r = workRulesInputSchema.safeParse({
      rules: [percent(), percent({ sectionId: null, serviceId: 1 })],
    })
    expect(r.success).toBe(true)
  })

  it('держит процент в 0–100 и целым', () => {
    for (const p of [-1, 101, 12.5]) {
      expect(workRulesInputSchema.safeParse({ rules: [percent({ percent: p })] }).success).toBe(
        false,
      )
    }
    expect(workRulesInputSchema.safeParse({ rules: [percent({ percent: 0 })] }).success).toBe(true)
  })

  it('требует ровно четыре неотрицательные суммы фикса', () => {
    const fixed = (fixedByClass: number[]) => ({
      rules: [{ sectionId: 1, serviceId: null, kind: 'fixed', fixedByClass }],
    })
    expect(workRulesInputSchema.safeParse(fixed([1, 2, 3])).success).toBe(false)
    expect(workRulesInputSchema.safeParse(fixed([1, 2, 3, -1])).success).toBe(false)
    expect(workRulesInputSchema.safeParse(fixed([0, 0, 0, 0])).success).toBe(true)
  })
})
