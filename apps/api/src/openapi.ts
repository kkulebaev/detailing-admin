import type { Context } from 'hono'
import type { z } from '@hono/zod-openapi'

// Single source of truth for the validation error wire shape that
// OpenAPIHono's `defaultHook` emits when `createRoute` validation fails.
// Wire format matches the legacy zValidator output: `{ ok:false, error:'validation', issues:[...] }`.
export function defaultValidationHook(
  result: { success: true } | { success: false; error: z.ZodError },
  c: Context,
) {
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      message: i.message,
    }))
    return c.json({ ok: false as const, error: 'validation' as const, issues }, 400)
  }
}
