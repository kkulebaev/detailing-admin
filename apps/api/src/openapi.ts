import type { Context } from 'hono'
import type { z } from '@hono/zod-openapi'
import { StatusCodes } from '@detailing-admin/shared'

// Единственный источник формы ответа об ошибке валидации, которую отдает
// `defaultHook` в OpenAPIHono, когда не проходит валидация `createRoute`.
// Формат совпадает со старым выводом zValidator: `{ ok:false, error:'validation', issues:[...] }`.
export function defaultValidationHook(
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context,
) {
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      message: i.message,
    }))
    return c.json(
      { ok: false as const, error: 'validation' as const, issues },
      StatusCodes.BAD_REQUEST,
    )
  }
}
