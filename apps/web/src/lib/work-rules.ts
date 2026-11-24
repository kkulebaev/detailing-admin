import { FIXED_CLASS_COUNT, type WorkRule, type WorkRuleKind } from '@detailing-admin/shared'
import type { PricelistSection } from './pricelist-api'
import { formatAmount } from './money'

export const CLASS_LABELS = ['I', 'II', 'III', 'IV'] as const

// Черновик правила в диалоге: числа хранятся строками, как их ввели, и превращаются
// в числа только при сохранении.
export interface WorkRuleDraft {
  key: string
  sectionId: number | null
  serviceId: number | null
  kind: WorkRuleKind
  percent: string
  fixed: string[]
}

export function targetKey(r: { sectionId: number | null; serviceId: number | null }): string {
  return r.serviceId != null ? `service:${r.serviceId}` : `section:${r.sectionId}`
}

export function ruleToDraft(r: WorkRule): WorkRuleDraft {
  return {
    key: targetKey(r),
    sectionId: r.sectionId,
    serviceId: r.serviceId,
    kind: r.kind,
    percent: r.kind === 'percent' ? String(r.percent) : '',
    fixed:
      r.kind === 'fixed'
        ? r.fixedByClass.map(String)
        : Array.from({ length: FIXED_CLASS_COUNT }, () => ''),
  }
}

export function emptyDraft(target: { sectionId: number | null; serviceId: number | null }) {
  return { ...ruleToDraft({ ...target, kind: 'percent', percent: 0 }), percent: '' }
}

export interface TargetInfo {
  // Индексы раздела и услуги в прайсе: по ним правила стоят в порядке прайса, а
  // правило раздела — перед исключениями из него.
  order: [number, number]
  title: string
  subtitle: string
}

export function describeTarget(
  r: { sectionId: number | null; serviceId: number | null },
  sections: PricelistSection[],
): TargetInfo {
  if (r.serviceId != null) {
    for (const [si, sec] of sections.entries()) {
      const vi = sec.services.findIndex((s) => s.id === r.serviceId)
      if (vi >= 0) {
        return {
          order: [si, vi + 1],
          title: sec.services[vi]!.name,
          subtitle: `${sec.name} · только эта услуга`,
        }
      }
    }
    return {
      order: [sections.length, 0],
      title: `Услуга #${r.serviceId}`,
      subtitle: 'нет в прайсе',
    }
  }
  const si = sections.findIndex((s) => s.id === r.sectionId)
  if (si >= 0) return { order: [si, 0], title: sections[si]!.name, subtitle: 'весь раздел' }
  return { order: [sections.length, 0], title: `Раздел #${r.sectionId}`, subtitle: 'нет в прайсе' }
}

export function sortByPricelist<T extends { sectionId: number | null; serviceId: number | null }>(
  rules: T[],
  sections: PricelistSection[],
): T[] {
  const order = (r: T) => describeTarget(r, sections).order
  return [...rules].sort((a, b) => {
    const [as, av] = order(a)
    const [bs, bv] = order(b)
    return as - bs || av - bv
  })
}

/** Короткая подпись оплаты: «40 %», «100 ₽» или «80–150 ₽», если суммы по классам разные. */
export function formatPay(r: WorkRule): string {
  if (r.kind === 'percent') return `${r.percent} %`
  const min = Math.min(...r.fixedByClass)
  const max = Math.max(...r.fixedByClass)
  return min === max ? `${formatAmount(min)} ₽` : `${formatAmount(min)}–${formatAmount(max)} ₽`
}

const DIGITS = /^\d+$/

export type DraftParse =
  | { ok: true; rules: WorkRule[] }
  | { ok: false; errors: Record<string, string> }

/** Черновики → правила для API; ошибки ключуются по `draft.key`. */
export function parseDrafts(drafts: WorkRuleDraft[]): DraftParse {
  const errors: Record<string, string> = {}
  const rules: WorkRule[] = []
  for (const d of drafts) {
    const target = { sectionId: d.sectionId, serviceId: d.serviceId }
    if (d.kind === 'percent') {
      const v = d.percent.trim()
      const n = Number(v)
      if (!DIGITS.test(v) || n > 100) {
        errors[d.key] = 'Укажите процент от 0 до 100'
        continue
      }
      rules.push({ ...target, kind: 'percent', percent: n })
    } else {
      const values = d.fixed.map((v) => v.trim())
      if (values.some((v) => !DIGITS.test(v))) {
        errors[d.key] = 'Укажите сумму для каждого класса, можно 0'
        continue
      }
      rules.push({ ...target, kind: 'fixed', fixedByClass: values.map(Number) })
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, rules }
}
