// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { UserPublic } from '@detailing-admin/shared'

const meMock = vi.fn()
vi.mock('@/lib/auth-api', () => ({
  me: () => meMock(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}))

import { createAppRouter } from '@/router'

function admin(): UserPublic {
  return { login: 'admin1', role: 'admin' }
}
function employee(): UserPublic {
  return { login: 'emp1', role: 'employee' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  meMock.mockReset()
})

describe('/salaries access', () => {
  it('lets an admin onto /salaries', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/salaries')
    expect(router.currentRoute.value.name).toBe('salaries')
  })

  it('redirects an employee away from /salaries to their home route', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/salaries')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('redirects an anonymous visitor from /salaries to /login', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/salaries')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/salaries')
  })
})
