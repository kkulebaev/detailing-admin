import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { UserPublic } from '@detailing-admin/shared'

const loginMock = vi.fn()
const logoutMock = vi.fn()
const meMock = vi.fn()
vi.mock('@/lib/auth-api', () => ({
  login: (...args: unknown[]) => loginMock(...args),
  logout: () => logoutMock(),
  me: () => meMock(),
  changePassword: vi.fn(),
}))

import { useAuthStore } from '@/stores/auth'

function adminUser(): UserPublic {
  return { login: 'admin1', role: 'admin', firstName: '', lastName: '' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  loginMock.mockReset()
  logoutMock.mockReset()
  meMock.mockReset()
})

describe('стор auth', () => {
  it('fetchMe при успехе ставит пользователя и отмечает ready', async () => {
    meMock.mockResolvedValue({ ok: true, user: adminUser() })
    const store = useAuthStore()
    await store.fetchMe()
    expect(store.user).toEqual(adminUser())
    expect(store.ready).toBe(true)
  })

  it('fetchMe при 401 сбрасывает пользователя, но все равно отмечает ready', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const store = useAuthStore()
    await store.fetchMe()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(true)
  })

  it('fetchMe сбрасывает пользователя и отмечает ready, если запрос бросает исключение', async () => {
    meMock.mockRejectedValue(new Error('network'))
    const store = useAuthStore()
    await store.fetchMe()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(true)
  })

  it('login при успехе ставит пользователя', async () => {
    loginMock.mockResolvedValue({ ok: true, user: adminUser() })
    const store = useAuthStore()
    const result = await store.login({ login: 'admin1', password: 'secret123' })
    expect(result.ok).toBe(true)
    expect(store.user).toEqual(adminUser())
    expect(store.ready).toBe(true)
  })

  it('login при ошибке оставляет пользователя пустым', async () => {
    loginMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const store = useAuthStore()
    const result = await store.login({ login: 'admin1', password: 'wrong' })
    expect(result.ok).toBe(false)
    expect(store.user).toBeNull()
  })

  it('logout вызывает API и сбрасывает пользователя', async () => {
    logoutMock.mockResolvedValue({ ok: true })
    const store = useAuthStore()
    store.user = adminUser()
    await store.logout()
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(store.user).toBeNull()
  })

  it('logout сбрасывает пользователя, даже если вызов API упал', async () => {
    logoutMock.mockRejectedValue(new Error('network'))
    const store = useAuthStore()
    store.user = adminUser()
    await store.logout()
    expect(store.user).toBeNull()
  })

  it('clearSession сбрасывает пользователя без вызова API', () => {
    const store = useAuthStore()
    store.user = adminUser()
    store.clearSession()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(true)
    expect(logoutMock).not.toHaveBeenCalled()
  })
})
