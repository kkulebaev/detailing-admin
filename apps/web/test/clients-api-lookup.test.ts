import { describe, it, expect, vi } from 'vitest'
import type { Client, ClientLookupMatch } from '@/lib/clients-api'

// Mock the generated transport so `lookupClientByPhone` resolves a controlled
// envelope without a real request. Only `getApiClientsLookup` is exercised here;
// the other exports are stubbed so the module import resolves.
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
  it('returns the match and asks for the exact phone', async () => {
    resolveLookup({ ok: true, match })
    await expect(lookupClientByPhone(E164)).resolves.toEqual(match)
    expect(getApiClientsLookup).toHaveBeenCalledWith({ phone: E164 })
  })

  it('returns null when nothing matches', async () => {
    resolveLookup({ ok: true, match: null })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })

  it('returns null silently on an unavailable (503) body', async () => {
    resolveLookup({ ok: false, error: 'unavailable', reason: 'db_unavailable' })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })
})
