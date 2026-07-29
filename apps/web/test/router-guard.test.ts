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

describe('router auth guard', () => {
  it('redirects an anonymous visitor away from a protected route to /login', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/clients')
  })

  it('redirects a role mismatch to the home route for that role', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('allows a matching role onto a protected route', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    expect(router.currentRoute.value.name).toBe('clients')
  })

  it('redirects an admin away from /employee to their home route', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/employee')
    expect(router.currentRoute.value.name).toBe('booking')
  })

  it('lets an employee onto /employee', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/employee')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('lets an employee onto the shared /profile route', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/profile')
    expect(router.currentRoute.value.name).toBe('profile')
  })

  it('redirects a logged-in visitor away from /login to their role home', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('booking')
  })

  it('leaves an anonymous visitor on /login', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('calls fetchMe once and reuses it across navigations (ready gate)', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    await router.push('/pricelist')
    await router.push('/masters')
    expect(meMock).toHaveBeenCalledTimes(1)
  })
})
