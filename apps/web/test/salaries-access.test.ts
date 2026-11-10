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
  return { login: 'admin1', role: 'admin', firstName: '', lastName: '' }
}
function employee(): UserPublic {
  return { login: 'emp1', role: 'employee', firstName: '', lastName: '' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  meMock.mockReset()
})

describe('доступ к /salaries', () => {
  it('пускает админа на /salaries', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/salaries')
    expect(router.currentRoute.value.name).toBe('salaries')
  })

  it('уводит сотрудника с /salaries на его домашний маршрут', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/salaries')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('уводит анонимного посетителя с /salaries на /login', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/salaries')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/salaries')
  })
})
