import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'
import { MAX_SERVICE_PRICE } from './booking.js'

// Вид работ мастера: что он умеет делать и сколько за это получает. Правило ставится
// на раздел прайса целиком или на отдельную услугу; правило услуги сильнее правила
// ее раздела, а услуга без обоих мастеру недоступна.
export const WORK_RULE_KINDS = ['percent', 'fixed'] as const
export type WorkRuleKind = (typeof WORK_RULE_KINDS)[number]

// Около сотни услуг в прайсе плюс разделы; предел только отсекает мусорный запрос.
export const MAX_WORK_RULES = 300

// Фикс задается на каждый класс кузова I–IV, как цены в прайсе: элемент [0] — класс I.
export const FIXED_CLASS_COUNT = 4

const targetId = z.number().int().positive()
const fixedAmount = z.number().int().nonnegative().max(MAX_SERVICE_PRICE)

const ruleTarget = {
  sectionId: targetId.nullable(),
  serviceId: targetId.nullable(),
}

const percentRule = z.object({
  ...ruleTarget,
  kind: z.literal('percent'),
  percent: z.number().int().min(0).max(100),
})
const fixedRule = z.object({
  ...ruleTarget,
  kind: z.literal('fixed'),
  fixedByClass: z.array(fixedAmount).length(FIXED_CLASS_COUNT),
})

export const workRuleSchema = z.discriminatedUnion('kind', [percentRule, fixedRule])

export type WorkRule = z.infer<typeof workRuleSchema>

function targetKey(r: Pick<WorkRule, 'sectionId' | 'serviceId'>): string {
  return r.serviceId != null ? `service:${r.serviceId}` : `section:${r.sectionId}`
}

// Полная замена правил мастера: форма всегда шлет весь список, поэтому «убрать вид
// работ» — это просто его отсутствие.
export const workRulesInputSchema = z
  .object({ rules: z.array(workRuleSchema).max(MAX_WORK_RULES) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>()
    v.rules.forEach((r, i) => {
      if ((r.sectionId == null) === (r.serviceId == null)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', i, 'sectionId'],
          message: 'Укажите раздел или услугу',
        })
        return
      }
      const key = targetKey(r)
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', i, r.serviceId != null ? 'serviceId' : 'sectionId'],
          message: 'Этот вид работ уже добавлен',
        })
      }
      seen.add(key)
    })
  })

export type WorkRulesInput = z.infer<typeof workRulesInputSchema>

const withMaster = { masterId: z.number().int() }
export const masterWorkRuleSchema = z.discriminatedUnion('kind', [
  percentRule.extend(withMaster),
  fixedRule.extend(withMaster),
])

export type MasterWorkRule = z.infer<typeof masterWorkRuleSchema>

export const workRulesListResponseSchema = z.union([
  z.object({ ok: z.literal(true), rules: z.array(masterWorkRuleSchema) }),
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const workRulesMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), rules: z.array(masterWorkRuleSchema) }),
  validationErrorSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])
