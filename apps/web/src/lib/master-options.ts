import { MASTERS, type Master } from '@detailing-admin/shared'

// Resolves the dropdown options for the booking form's master/responsible
// selects. The booking flow must never depend on Postgres, so this collapses
// to the hard-coded `MASTERS` enum whenever the live list is missing, still
// loading, or yields no candidates after filtering (empty table / nobody with
// the required role). Guarantee: the returned list is never empty.
export function resolveMasterOptions(
  data: Master[] | undefined,
  filter: (m: Master) => boolean,
): string[] {
  if (!data) return [...MASTERS]
  const names = data.filter(filter).map((m) => m.name)
  return names.length > 0 ? names : [...MASTERS]
}
