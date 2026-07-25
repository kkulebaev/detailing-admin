import type { Master } from '@detailing-admin/shared'

// Resolves the booking form's master/responsible dropdown options from the live
// `masters` table. Returns an empty list when the data is missing (loading / DB
// unavailable / empty table); the form surfaces a warning in that case instead
// of falling back to a hard-coded list.
export function resolveMasterOptions(
  data: Master[] | undefined,
  filter: (m: Master) => boolean,
): string[] {
  if (!data) return []
  return data.filter(filter).map((m) => m.name)
}
