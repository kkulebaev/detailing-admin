import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusCodes } from '@detailing-admin/shared'
import type { OrvalEnvelope } from '@/lib/orval-mutator'

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response
}

describe('orvalFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Свежий реестр модулей на каждый тест: `unauthorizedHandler` — изменяемое
    // состояние уровня модуля (задается через `setUnauthorizedHandler`), и тесты
    // не должны видеть обработчик, зарегистрированный предыдущим тестом.
    vi.resetModules()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('отправляет credentials: include в каждом запросе', async () => {
    fetchMock.mockResolvedValue(jsonResponse(StatusCodes.OK, { ok: true }))
    const { orvalFetch } = await import('@/lib/orval-mutator')
    await orvalFetch<OrvalEnvelope<unknown>>('/api/clients')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('вызывает unauthorized-обработчик на 401 вне путей, освобожденных от авторизации', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(StatusCodes.UNAUTHORIZED, { ok: false, error: 'unauthorized' }),
    )
    const { orvalFetch, setUnauthorizedHandler } = await import('@/lib/orval-mutator')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await orvalFetch<OrvalEnvelope<unknown>>('/api/clients')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('не вызывает обработчик на ответе, отличном от 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(StatusCodes.OK, { ok: true }))
    const { orvalFetch, setUnauthorizedHandler } = await import('@/lib/orval-mutator')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await orvalFetch<OrvalEnvelope<unknown>>('/api/clients')
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['/api/auth/login', '/api/auth/me', '/api/auth/logout'])(
    'не вызывает unauthorized-обработчик для %s',
    async (path) => {
      fetchMock.mockResolvedValue(
        jsonResponse(StatusCodes.UNAUTHORIZED, { ok: false, error: 'unauthorized' }),
      )
      const { orvalFetch, setUnauthorizedHandler } = await import('@/lib/orval-mutator')
      const handler = vi.fn()
      setUnauthorizedHandler(handler)
      await orvalFetch<OrvalEnvelope<unknown>>(path)
      expect(handler).not.toHaveBeenCalled()
    },
  )
})
