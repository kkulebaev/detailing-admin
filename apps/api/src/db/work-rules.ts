import { and, asc, eq, inArray } from 'drizzle-orm'
import type { MasterWorkRule, WorkRule } from '@detailing-admin/shared'
import { getDb } from './client.js'
import {
  masterWorkRules,
  masters,
  sections,
  services,
  type MasterWorkRuleRow,
  type NewMasterWorkRuleRow,
} from './schema.js'

export type WorkRuleMutationError = 'master_not_found' | 'unknown_target'

export class WorkRuleError extends Error {
  constructor(
    public readonly code: WorkRuleMutationError,
    // Для unknown_target: путь поля в теле запроса, чтобы форма подсветила строку.
    public readonly path: (string | number)[] = [],
  ) {
    super(code)
    this.name = 'WorkRuleError'
  }
}

type RuleRowFields = Omit<MasterWorkRuleRow, 'id' | 'updatedAt'>

export function ruleToRow(masterId: number, r: WorkRule): Omit<NewMasterWorkRuleRow, 'id'> {
  const target = { masterId, sectionId: r.sectionId, serviceId: r.serviceId }
  if (r.kind === 'percent') {
    return {
      ...target,
      kind: 'percent',
      percent: r.percent,
      fixedClass1: null,
      fixedClass2: null,
      fixedClass3: null,
      fixedClass4: null,
    }
  }
  const [c1, c2, c3, c4] = r.fixedByClass
  return {
    ...target,
    kind: 'fixed',
    percent: null,
    fixedClass1: c1!,
    fixedClass2: c2!,
    fixedClass3: c3!,
    fixedClass4: c4!,
  }
}

// CHECK-ограничения таблицы гарантируют, что у процента есть percent, а у фикса все
// четыре суммы, поэтому `?? 0` здесь не срабатывает и нужен только типу.
export function rowToRule(row: RuleRowFields): MasterWorkRule {
  const target = { masterId: row.masterId, sectionId: row.sectionId, serviceId: row.serviceId }
  if (row.kind === 'percent') return { ...target, kind: 'percent', percent: row.percent ?? 0 }
  return {
    ...target,
    kind: 'fixed',
    fixedByClass: [row.fixedClass1, row.fixedClass2, row.fixedClass3, row.fixedClass4].map(
      (v) => v ?? 0,
    ),
  }
}

/** Правила всех неархивных мастеров в порядке, в котором их сохранили. */
export async function listWorkRules(): Promise<MasterWorkRule[]> {
  const db = getDb()
  const rows = await db
    .select({
      masterId: masterWorkRules.masterId,
      sectionId: masterWorkRules.sectionId,
      serviceId: masterWorkRules.serviceId,
      kind: masterWorkRules.kind,
      percent: masterWorkRules.percent,
      fixedClass1: masterWorkRules.fixedClass1,
      fixedClass2: masterWorkRules.fixedClass2,
      fixedClass3: masterWorkRules.fixedClass3,
      fixedClass4: masterWorkRules.fixedClass4,
    })
    .from(masterWorkRules)
    .innerJoin(masters, eq(masters.id, masterWorkRules.masterId))
    .where(eq(masters.archived, false))
    .orderBy(asc(masterWorkRules.masterId), asc(masterWorkRules.id))
  return rows.map(rowToRule)
}

/** Полностью заменяет правила мастера одной транзакцией. Архивный или неизвестный
 * мастер — master_not_found; раздел или услуга, которых нет в прайсе, — unknown_target
 * (проверяется заранее, иначе FK уронил бы запрос невнятным 500). */
export async function replaceMasterWorkRules(
  masterId: number,
  rules: WorkRule[],
): Promise<MasterWorkRule[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    // FOR UPDATE: архивирование мастера параллельно с сохранением не оставит правил
    // у мастера, которого уже не видно.
    const [master] = await tx
      .select({ id: masters.id })
      .from(masters)
      .where(and(eq(masters.id, masterId), eq(masters.archived, false)))
      .for('update')
    if (!master) throw new WorkRuleError('master_not_found')

    const sectionIds = [
      ...new Set(rules.flatMap((r) => (r.sectionId != null ? [r.sectionId] : []))),
    ]
    const serviceIds = [
      ...new Set(rules.flatMap((r) => (r.serviceId != null ? [r.serviceId] : []))),
    ]
    const liveSections = new Set(
      sectionIds.length > 0
        ? (
            await tx
              .select({ id: sections.id })
              .from(sections)
              .where(inArray(sections.id, sectionIds))
          ).map((s) => s.id)
        : [],
    )
    const liveServices = new Set(
      serviceIds.length > 0
        ? (
            await tx
              .select({ id: services.id })
              .from(services)
              .where(inArray(services.id, serviceIds))
          ).map((s) => s.id)
        : [],
    )
    rules.forEach((r, i) => {
      if (r.sectionId != null && !liveSections.has(r.sectionId)) {
        throw new WorkRuleError('unknown_target', ['rules', i, 'sectionId'])
      }
      if (r.serviceId != null && !liveServices.has(r.serviceId)) {
        throw new WorkRuleError('unknown_target', ['rules', i, 'serviceId'])
      }
    })

    await tx.delete(masterWorkRules).where(eq(masterWorkRules.masterId, masterId))
    if (rules.length === 0) return []
    const inserted = await tx
      .insert(masterWorkRules)
      .values(rules.map((r) => ruleToRow(masterId, r)))
      .returning()
    return inserted.map(rowToRule)
  })
}
