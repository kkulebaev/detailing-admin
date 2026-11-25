import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

// Через hoisted, а не экспортом из мока: мок в browser mode теряет экспорты,
// которых нет у настоящего модуля.
const q = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    unread: ref<{ ok: true; unreadCount: number } | undefined>(undefined),
    refreshUnread: (() => {}) as () => void,
  }
})

vi.mock('@/lib/queries', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    usePendingScheduleRequestsQuery: () => ({ data: ref(undefined), refresh: vi.fn() }),
    useUnreadNotificationsQuery: () => ({ data: q.unread, refresh: () => q.refreshUnread() }),
  }
})

// Настоящая регистрация поставила бы воркер в браузер прогона.
vi.mock('@/lib/push', () => ({
  registerServiceWorker: vi.fn(),
  setAppBadge: vi.fn(),
}))

import AppSidebar from '@/components/AppSidebar.vue'
import { SidebarProvider } from '@/components/ui/sidebar'
import { useAuthStore } from '@/stores/auth'
import { blankRoute, createTestRouter } from './helpers/router'

const NAMES = [
  'booking',
  'bookings',
  'clients',
  'pricelist',
  'masters',
  'schedule',
  'salaries',
  'analytics',
  'employee',
  'notifications',
  'profile',
]

const Shell = defineComponent({ render: () => h(SidebarProvider, null, () => h(AppSidebar)) })

async function mountSidebar(role: 'admin' | 'booker' | 'employee') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().user = { login: 'u', role, firstName: '', lastName: '' }
  const router = await createTestRouter('/', {
    routes: NAMES.map((name) => blankRoute(`/${name}`, name)).concat(blankRoute('/', 'home')),
  })
  return mount(Shell, { attachTo: document.body, global: { plugins: [pinia, router] } })
}

enableAutoUnmount(afterEach)

describe('AppSidebar — счетчик уведомлений', () => {
  beforeEach(async () => {
    // На узком экране сайдбар уезжает в закрытый Sheet.
    await page.viewport(1280, 800)
    q.unread.value = undefined
    q.refreshUnread = vi.fn()
  })

  it.each(['admin', 'booker', 'employee'] as const)(
    'пункт «Уведомления» есть у %s',
    async (role) => {
      await mountSidebar(role)
      await expect.element(page.getByRole('link', { name: /^Уведомления/ })).toBeVisible()
    },
  )

  it('пункт стоит в футере, над профилем', async () => {
    await mountSidebar('admin')
    const footer = document.querySelector('[data-sidebar="footer"]')
    const links = [...(footer?.querySelectorAll('a') ?? [])].map((a) => a.textContent?.trim())
    expect(links[0]).toMatch(/^Уведомления/)
    expect(links).toHaveLength(2)
  })

  it('показывает число непрочитанных', async () => {
    q.unread.value = { ok: true, unreadCount: 3 }
    await mountSidebar('employee')
    await expect
      .element(page.getByRole('link', { name: /^Уведомления\s*,\s*непрочитанных: 3$/ }))
      .toBeVisible()
  })

  it('без непрочитанных счетчика нет', async () => {
    q.unread.value = { ok: true, unreadCount: 0 }
    await mountSidebar('employee')
    await expect.element(page.getByRole('link', { name: 'Уведомления' })).toBeVisible()
  })

  it('опрашивает счетчик раз в минуту', async () => {
    vi.useFakeTimers()
    try {
      await mountSidebar('employee')
      expect(q.refreshUnread).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60_000)
      expect(q.refreshUnread).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
