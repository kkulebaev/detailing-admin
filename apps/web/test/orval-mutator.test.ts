import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusCodes } from '@detailing-admin/shared'
import type { OrvalEnvelope } from '@/lib/orval-mutator'

function jsonResponse(status: number, body: unknown): Response {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response
}

describe('orvalFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Fresh module registry per test: `unauthorizedHandler` is module-level
    // mutable state (set via `setUnauthorizedHandler`), and tests must not
    // see a handler registered by a previous test.
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends credentials: include on every request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(StatusCodes.OK, { ok: true }))
    const { orvalFetch } = await import('@/lib/orval-mutator')
    await orvalFetch<OrvalEnvelope<unknown>>('/api/clients')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('invokes the unauthorized handler on a 401 outside the auth-exempt paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse(StatusCodes.UNAUTHORIZED, { ok: false, error: 'unauthorized' }))
    const { orvalFetch, setUnauthorizedHandler } = await import('@/lib/orval-mutator')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await orvalFetch<OrvalEnvelope<unknown>>('/api/clients')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the handler on a non-401 response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(StatusCodes.OK, { ok: true }))
    const { orvalFetch, setUnauthorizedHandler } = await import('@/lib/orval-mutator')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await orvalFetch<OrvalEnvelope<unknown>>('/api/clients')
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['/api/auth/login', '/api/auth/me', '/api/auth/logout'])(
    'does not invoke the unauthorized handler for %s',
    async (path) => {
      fetchMock.mockResolvedValue(jsonResponse(StatusCodes.UNAUTHORIZED, { ok: false, error: 'unauthorized' }))
      const { orvalFetch, setUnauthorizedHandler } = await import('@/lib/orval-mutator')
      const handler = vi.fn()
      setUnauthorizedHandler(handler)
      await orvalFetch<OrvalEnvelope<unknown>>(path)
      expect(handler).not.toHaveBeenCalled()
    },
  )
})
