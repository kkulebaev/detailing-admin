import { z } from 'zod'

/**
 * Boundary parser shared by all per-domain api wrappers. Orval's generated
 * functions already do `fetch` + `JSON.parse`, but they cast the body straight
 * into the spec-derived union — `parseResponse` re-validates against the same
 * Zod schemas the routes use, so a server returning an unexpected shape
 * collapses to the schema's `internal` variant instead of leaking through.
 *
 * The success path: pull `data` off orval's `{ data, status, headers }` envelope
 * and `safeParse` it. The failure fallback round-trips through `schema.parse`
 * so the `T` return type is preserved without needing a type assertion.
 */
export async function parseResponse<T>(
  call: () => Promise<{ data: unknown }>,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    const { data } = await call()
    const parsed = schema.safeParse(data)
    if (parsed.success) return parsed.data
  } catch {
    // network error, JSON parse failure, schema mismatch — fall through to internal
  }
  return schema.parse({ ok: false, error: 'internal' })
}
