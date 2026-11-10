import { describe, it, expect, vi } from 'vitest'
import type { Client, ClientLookupMatch } from '@/lib/clients-api'

// Мокаем сгенерированный транспорт, чтобы `lookupClientByPhone` получал управляемый
// конверт без реального запроса. Здесь используется только `getApiClientsLookup`;
// остальные экспорты — заглушки, чтобы импорт модуля разрешился.
vi.mock('@/lib/generated/clients/clients', () => ({
  getApiClients: vi.fn(),
  getApiClientsId: vi.fn(),
  getApiClientsLookup: vi.fn(),
  postApiClients: vi.fn(),
  patchApiClientsId: vi.fn(),
  deleteApiClientsId: vi.fn(),
}))

import { getApiClientsLookup } from '@/lib/generated/clients/clients'
import { lookupClientByPhone } from '@/lib/clients-api'

const E164 = '+79161234567'

const client: Client = {
  id: '11111111-1111-1111-1111-111111111111',
  phone: E164,
  name: 'Иван',
  createdAt: '2026-01-01T00:00:00.000Z',
  cars: [],
}

const match: ClientLookupMatch = {
  client,
  summary: { visitCount: 1, lastVisit: '2026-09-12', lastService: 'Мойка', missed: null },
}

function resolveLookup(body: unknown) {
  vi.mocked(getApiClientsLookup).mockResolvedValue({ data: body } as never)
}

describe('lookupClientByPhone', () => {
  it('возвращает совпадение и запрашивает точный телефон', async () => {
    resolveLookup({ ok: true, match })
    await expect(lookupClientByPhone(E164)).resolves.toEqual(match)
    expect(getApiClientsLookup).toHaveBeenCalledWith({ phone: E164 })
  })

  it('возвращает null, если совпадений нет', async () => {
    resolveLookup({ ok: true, match: null })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })

  it('молча возвращает null на теле unavailable (503)', async () => {
    resolveLookup({ ok: false, error: 'unavailable', reason: 'db_unavailable' })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })
})
