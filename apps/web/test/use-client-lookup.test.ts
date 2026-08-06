import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import type { Client } from '@/lib/clients-api'

// Capture the `e164` ref the composable feeds the query and hand back a
// controllable `data` ref — this exercises the composable's phone gating and
// passthrough without standing up pinia-colada. The exact phone guard and the
// silent-failure mapping live in `lookupClientByPhone` (covered separately);
// here `data` is already `Client | null`.
let capturedE164: Ref<string | null> | null = null
const data = ref<Client | null>(null)

vi.mock('@/lib/queries', () => ({
  useClientLookupByPhoneQuery: (e164: Ref<string | null>) => {
    capturedE164 = e164
    return { data }
  },
}))

import { useClientLookup } from '@/composables/use-client-lookup'

const client: Client = {
  id: '11111111-1111-1111-1111-111111111111',
  phone: '+79161234567',
  name: 'Иван',
  createdAt: '2026-01-01T00:00:00.000Z',
  cars: [],
}

describe('useClientLookup', () => {
  beforeEach(() => {
    capturedE164 = null
    data.value = null
  })

  it('passes a normalized E.164 to the query for a full masked phone', () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBe('+79161234567')
  })

  it('surfaces the matched client from the query data', async () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    const { matchedClient } = useClientLookup(phoneRaw)
    data.value = client
    await nextTick()
    expect(matchedClient.value).toEqual(client)
  })

  it('keeps e164 null for a partial phone (query stays disabled)', () => {
    const phoneRaw = ref('+7 (916) 12')
    const { matchedClient } = useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBeNull()
    expect(matchedClient.value).toBeNull()
  })

  it('keeps e164 null for garbage input', () => {
    const phoneRaw = ref('не телефон')
    useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBeNull()
  })

  it('returns null when the query has no match', () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    const { matchedClient } = useClientLookup(phoneRaw)
    expect(matchedClient.value).toBeNull()
  })

  it('flips e164 to null when the phone is cleared', async () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBe('+79161234567')
    phoneRaw.value = ''
    await nextTick()
    expect(capturedE164?.value).toBeNull()
  })
})
