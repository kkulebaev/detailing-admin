import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import type { Client, ClientLookupMatch } from '@/lib/clients-api'

// Перехватываем ref `e164`, который composable передаёт в запрос, и отдаём
// управляемый ref `data` — так проверяются фильтрация телефона и проброс данных
// в composable без поднятия pinia-colada. Тихая обработка ошибок живёт
// в `lookupClientByPhone` (покрыта отдельно).
let capturedE164: Ref<string | null> | null = null
const data = ref<ClientLookupMatch | null>(null)

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

  it('для полного телефона по маске передаёт в запрос нормализованный E.164', () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBe('+79161234567')
  })

  it('отдаёт найденного клиента и его сводку из данных запроса', async () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    const { matchedClient, matchedClientSummary } = useClientLookup(phoneRaw)
    const summary = { visitCount: 1, lastVisit: '2026-09-12', lastService: 'Мойка', missed: null }
    data.value = { client, summary }
    await nextTick()
    expect(matchedClient.value).toEqual(client)
    expect(matchedClientSummary.value).toEqual(summary)
  })

  it('оставляет e164 равным null для неполного телефона (запрос остаётся выключенным)', () => {
    const phoneRaw = ref('+7 (916) 12')
    const { matchedClient } = useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBeNull()
    expect(matchedClient.value).toBeNull()
  })

  it('оставляет e164 равным null для мусорного ввода', () => {
    const phoneRaw = ref('не телефон')
    useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBeNull()
  })

  it('возвращает null, если запрос ничего не нашёл', () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    const { matchedClient } = useClientLookup(phoneRaw)
    expect(matchedClient.value).toBeNull()
  })

  it('сбрасывает e164 в null, когда телефон очищен', async () => {
    const phoneRaw = ref('+7 (916) 123-45-67')
    useClientLookup(phoneRaw)
    expect(capturedE164?.value).toBe('+79161234567')
    phoneRaw.value = ''
    await nextTick()
    expect(capturedE164?.value).toBeNull()
  })
})
