import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@/lib/clients-api'

// Mock the generated transport so `fetchClients` (and thus `lookupClientByPhone`)
// resolves a controlled envelope without a real request. Only `getApiClients` is
// exercised here; the other exports are stubbed so the module import resolves.
vi.mock('@/lib/generated/clients/clients', () => ({
  getApiClients: vi.fn(),
  getApiClientsId: vi.fn(),
  postApiClients: vi.fn(),
  patchApiClientsId: vi.fn(),
  deleteApiClientsId: vi.fn(),
}))

import { getApiClients } from '@/lib/generated/clients/clients'
import { lookupClientByPhone } from '@/lib/clients-api'

const E164 = '+79161234567'

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    phone: E164,
    name: 'Иван',
    createdAt: '2026-01-01T00:00:00.000Z',
    cars: [],
    ...overrides,
  }
}

function resolveList(body: unknown) {
  vi.mocked(getApiClients).mockResolvedValue({ data: body } as never)
}

describe('lookupClientByPhone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the client on an exact phone match', async () => {
    const c = client()
    resolveList({ ok: true, clients: [c], total: 1 })
    await expect(lookupClientByPhone(E164)).resolves.toEqual(c)
    expect(getApiClients).toHaveBeenCalledWith({ q: E164, limit: 1 })
  })

  it('returns null when the ilike match has a different phone', async () => {
    resolveList({ ok: true, clients: [client({ phone: '+79990000000' })], total: 1 })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })

  it('returns null when nothing matches', async () => {
    resolveList({ ok: true, clients: [], total: 0 })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })

  it('returns null silently on an unavailable (503) body', async () => {
    resolveList({ ok: false, error: 'unavailable', reason: 'db_unavailable' })
    await expect(lookupClientByPhone(E164)).resolves.toBeNull()
  })
})
