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
function booker(): UserPublic {
  return { login: 'booker1', role: 'booker', firstName: '', lastName: '' }
}
function employee(): UserPublic {
  return { login: 'emp1', role: 'employee', firstName: '', lastName: '' }
}

beforeEach(() => {
  setActivePinia(createPinia())
  meMock.mockReset()
})

describe('auth-guard роутера', () => {
  it('уводит анонимного посетителя с защищённого маршрута на /login', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/clients')
  })

  it('при несовпадении роли перенаправляет на домашний маршрут этой роли', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('пускает подходящую роль на защищённый маршрут', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    expect(router.currentRoute.value.name).toBe('clients')
  })

  it('уводит админа с /employee на его домашний маршрут', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/employee')
    expect(router.currentRoute.value.name).toBe('booking')
  })

  it('пускает сотрудника на /employee', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/employee')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('пускает сотрудника на общий маршрут /profile', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/profile')
    expect(router.currentRoute.value.name).toBe('profile')
  })

  it('отправляет букера домой — на форму записи', async () => {
    meMock.mockResolvedValue({ ok: true, user: booker() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('booking')
  })

  it.each(['bookings', 'employee', 'profile'])('пускает букера на /%s', async (path) => {
    meMock.mockResolvedValue({ ok: true, user: booker() })
    const router = createAppRouter(createMemoryHistory())
    await router.push(`/${path}`)
    expect(router.currentRoute.value.name).toBe(path)
  })

  it.each(['clients', 'pricelist', 'masters', 'salaries', 'analytics'])(
    'не пускает букера на /%s',
    async (path) => {
      meMock.mockResolvedValue({ ok: true, user: booker() })
      const router = createAppRouter(createMemoryHistory())
      await router.push(`/${path}`)
      expect(router.currentRoute.value.name).toBe('booking')
    },
  )

  it('не пускает сотрудника на форму записи', async () => {
    meMock.mockResolvedValue({ ok: true, user: employee() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('employee')
  })

  it('уводит вошедшего посетителя с /login на домашний маршрут его роли', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('booking')
  })

  it('оставляет анонимного посетителя на /login', async () => {
    meMock.mockResolvedValue({ ok: false, error: 'unauthorized' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('вызывает fetchMe один раз и переиспользует результат между переходами (ready gate)', async () => {
    meMock.mockResolvedValue({ ok: true, user: admin() })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clients')
    await router.push('/pricelist')
    await router.push('/masters')
    expect(meMock).toHaveBeenCalledTimes(1)
  })
})
