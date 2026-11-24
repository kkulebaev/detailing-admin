import { z } from 'zod'
import {
  workRulesListResponseSchema,
  workRulesMutationResponseSchema,
  type MasterWorkRule,
  type WorkRule,
} from '@detailing-admin/shared'
import { unwrap } from './api-client'
import {
  getApiSalariesWorkRules,
  putApiSalariesWorkRulesMasterId,
} from './generated/salaries/salaries'

export type { MasterWorkRule, WorkRule }

export type WorkRulesListResult = z.infer<typeof workRulesListResponseSchema>
export type WorkRulesMutationResult = z.infer<typeof workRulesMutationResponseSchema>

export function fetchWorkRules(): Promise<WorkRulesListResult> {
  return unwrap<WorkRulesListResult>(() => getApiSalariesWorkRules())
}

export function saveMasterWorkRules(
  masterId: number,
  rules: WorkRule[],
): Promise<WorkRulesMutationResult> {
  return unwrap<WorkRulesMutationResult>(() =>
    putApiSalariesWorkRulesMasterId(String(masterId), { rules }),
  )
}
