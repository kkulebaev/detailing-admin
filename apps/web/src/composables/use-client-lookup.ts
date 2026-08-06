import { computed, type Ref } from 'vue'
import { normalizePhone } from '@detailing-admin/shared'
import { useClientLookupByPhoneQuery } from '@/lib/queries'
import type { Client } from '@/lib/clients-api'

// Autofill helper for the booking form: turns the raw phone input into an
// exact client match. `e164` is null until the typed number normalises to a
// full +7XXXXXXXXXX — that gates the underlying query, so partial/garbage input
// never fires a request. colada handles dedup/cache/stale; a reset to an empty
// phone flips `e164` to null (enabled=false) so a late resolve of a stale key
// is never applied. `data` is already `Client | null` (the exact phone guard
// lives in `lookupClientByPhone`), so there is no re-guard here.
export function useClientLookup(phoneRaw: Ref<string>) {
  const e164 = computed<string | null>(() => {
    try {
      const n = normalizePhone(phoneRaw.value)
      return /^\+7\d{10}$/.test(n) ? n : null
    } catch {
      return null
    }
  })

  const { data, asyncStatus } = useClientLookupByPhoneQuery(e164)

  const matchedClient = computed<Client | null>(() => data.value ?? null)

  // Only "loading" while a real lookup is in flight (full number typed) — a null
  // e164 keeps the query disabled, so this stays false for partial input.
  const isLoading = computed(() => !!e164.value && asyncStatus.value === 'loading')

  return { matchedClient, isLoading }
}
