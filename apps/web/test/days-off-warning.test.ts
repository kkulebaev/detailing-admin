import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Master, ScheduleQuery } from '@detailing-admin/shared'

const requested = vi.hoisted(() => ({ range: null as { value: unknown } | null }))

const masters: Master[] = [
  {
    id: 1,
    name: 'Иван',
    position: 0,
    canBeResponsible: true,
    paidSalary: true,
    userId: null,
  },
  {
    id: 2,
    name: 'Петр',
    position: 1,
    canBeResponsible: true,
    paidSalary: true,
    userId: null,
  },
]

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useMastersQuery: () => ({ data: ref({ ok: true, masters }) }),
    useScheduleQuery: (range: { value: unknown }) => {
      requested.range = range
      return {
        data: ref({
          ok: true,
          from: '2026-11-01',
          to: '2026-11-30',
          // У Петра ноябрь не заполнен: каждый его день — выходной.
          schedule: [{ masterId: 1, dates: ['2026-11-16'] }],
        }),
      }
    },
  }
})

import { useDaysOffWarning } from '@/composables/use-days-off-warning'

describe('useDaysOffWarning', () => {
  it('называет мастеров и их выходные дни, включая незаполненный график', () => {
    const warning = useDaysOffWarning(ref('2026-11-16'), ref('2026-11-17'), ref(['Иван', 'Петр']))
    expect(warning.value).toEqual(['Иван — 17.11', 'Петр — 16.11, 17.11'])
    expect((requested.range?.value as ScheduleQuery).from).toBe('2026-11-01')
  })

  it('молчит, если мастер работает', () => {
    const warning = useDaysOffWarning(ref('2026-11-16'), ref(null), ref(['Иван']))
    expect(warning.value).toEqual([])
  })

  it('не грузит график, пока не выбраны мастер и дата', () => {
    useDaysOffWarning(ref(null), ref(null), ref(['Иван']))
    expect(requested.range?.value).toBeNull()
    useDaysOffWarning(ref('2026-11-16'), ref(null), ref([]))
    expect(requested.range?.value).toBeNull()
  })

  it('игнорирует ответ за другой диапазон, пока грузится новый', () => {
    const warning = useDaysOffWarning(ref('2026-12-03'), ref(null), ref(['Иван']))
    expect(warning.value).toEqual([])
  })

  describe('skipPast', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('не предупреждает о прошедших днях', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 10, 17, 12))
      const warning = useDaysOffWarning(ref('2026-11-15'), ref('2026-11-18'), ref(['Иван']), {
        skipPast: true,
      })
      expect(warning.value).toEqual(['Иван — 17.11, 18.11'])
    })
  })
})
