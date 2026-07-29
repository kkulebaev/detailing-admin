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
  return { login: 'admin1', role: 'admin' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  loginMock.mockReset()
  logoutMock.mockReset()
  meMock.mockReset()
})

describe('auth store', () => {
  it('fetchMe sets the user and marks ready on success', async () => {
    meMock.mockResolvedValue({ ok: true, user: adminUser() })
    const store = useAuthStore()
    await store.fetchMe()
    expect(store.user).toEqual(adminUser())
    expect(store.ready).toBe(true)
  })

  it('fetchMe clears the user and still marks ready on 401', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const store = useAuthStore()
    await store.fetchMe()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(true)
  })

  it('fetchMe clears the user and marks ready when the request throws', async () => {
    meMock.mockRejectedValue(new Error('network'))
    const store = useAuthStore()
    await store.fetchMe()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(true)
  })

  it('login sets the user on success', async () => {
    loginMock.mockResolvedValue({ ok: true, user: adminUser() })
    const store = useAuthStore()
    const result = await store.login({ login: 'admin1', password: 'secret123' })
    expect(result.ok).toBe(true)
    expect(store.user).toEqual(adminUser())
    expect(store.ready).toBe(true)
  })

  it('login leaves the user unset on failure', async () => {
    loginMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const store = useAuthStore()
    const result = await store.login({ login: 'admin1', password: 'wrong' })
    expect(result.ok).toBe(false)
    expect(store.user).toBeNull()
  })

  it('logout calls the API and clears the user', async () => {
    logoutMock.mockResolvedValue({ ok: true })
    const store = useAuthStore()
    store.user = adminUser()
    await store.logout()
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(store.user).toBeNull()
  })

  it('logout clears the user even if the API call fails', async () => {
    logoutMock.mockRejectedValue(new Error('network'))
    const store = useAuthStore()
    store.user = adminUser()
    await store.logout()
    expect(store.user).toBeNull()
  })

  it('clearSession clears the user without calling the API', () => {
    const store = useAuthStore()
    store.user = adminUser()
    store.clearSession()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(true)
    expect(logoutMock).not.toHaveBeenCalled()
  })
})
