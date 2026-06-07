// Boundary helper shared by all per-domain api wrappers. Orval's generated
// functions return `{ data, status, headers }` envelopes typed as a per-status
// discriminated union; we widen `data` to `unknown` here and cast to the
// consumer-facing ApiResult variant. The OpenAPI spec is generated from the
// same Zod schemas the routes use, so the two unions are structurally
// identical — collapsing them at this single boundary is safe.
//
// Network errors and JSON-parse failures propagate as thrown errors (Pinia
// Colada surfaces them via `state.error` / `asyncStatus === 'error'`).
export async function unwrap<T>(
  call: () => Promise<{ data: unknown }>,
): Promise<T> {
  const { data } = await call()
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return data as T
}
