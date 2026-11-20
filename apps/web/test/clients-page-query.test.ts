import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { page, userEvent } from 'vitest/browser'
import type { ComputedRef } from 'vue'
import type { Router } from 'vue-router'
import type { GetApiClientsParams } from '@/lib/clients-api'
import { blankRoute, createTestRouter } from './helpers/router'

const state = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    params: null as ComputedRef<GetApiClientsParams> | null,
    total: ref(1),
  }
})

vi.mock('@/lib/queries', async () => {
  const { computed, ref } = await vi.importActual<typeof import('vue')>('vue')
  return {
    useClientsQuery: (params: ComputedRef<GetApiClientsParams>) => {
      state.params = params
      return {
        data: computed(() => ({
          ok: true,
          clients: [
            {
              id: 'c1',
              name: 'Иван',
              phone: '+79160000001',
              createdAt: '2026-01-01T00:00:00.000Z',
              cars: [],
            },
          ],
          total: state.total.value,
        })),
        error: ref(null),
        asyncStatus: ref('idle'),
      }
    },
    useInvalidateClients: () => vi.fn(),
    useClientDetailQuery: () => ({
      data: ref(undefined),
      error: ref(null),
      asyncStatus: ref('loading'),
      refetch: vi.fn(),
    }),
  }
})

import ClientsPage from '@/components/ClientsPage.vue'

async function mountAt(path: string): Promise<Router> {
  const router = await createTestRouter(path, {
    routes: [blankRoute('/clients', 'clients'), blankRoute('/clients/:id', 'client-detail')],
  })
  mount(ClientsPage, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { ClientFormDialog: true } },
  })
  return router
}

const params = () => state.params!.value
const searchBox = () => page.getByRole('searchbox')

enableAutoUnmount(afterEach)

describe('ClientsPage — фильтры в адресе', () => {
  beforeEach(() => {
    state.total.value = 1
  })

  it('открывает поиск, сортировку и страницу из адреса', async () => {
    state.total.value = 120
    await mountAt(`/clients?q=${encodeURIComponent('иван')}&sort=phone&dir=desc&page=2`)

    expect(params()).toMatchObject({ q: 'иван', sort: 'phone', dir: 'desc', offset: 50 })
    await expect.element(searchBox()).toHaveValue('иван')
  })

  it('карточка уносит фильтры в свой адрес и возвращает их при закрытии', async () => {
    const router = await mountAt('/clients?q=a&sort=phone')

    await page.getByRole('button', { name: 'Открыть карточку клиента Иван' }).click()
    await expect.poll(() => router.currentRoute.value.fullPath).toBe('/clients/c1?q=a&sort=phone')

    await userEvent.keyboard('{Escape}')
    await expect.poll(() => router.currentRoute.value.fullPath).toBe('/clients?q=a&sort=phone')
    await expect.element(searchBox()).toHaveValue('a')
  })

  it('карточка из прямой ссылки при закрытии оставляет фильтры списка', async () => {
    const router = await mountAt('/clients/c1?q=a&sort=phone')
    await expect.element(page.getByRole('dialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    await expect.poll(() => router.currentRoute.value.fullPath).toBe('/clients?q=a&sort=phone')
    expect(params()).toMatchObject({ q: 'a', sort: 'phone' })
    await expect.element(searchBox()).toHaveValue('a')
  })

  it('страница за концом списка сменяется последней', async () => {
    state.total.value = 60
    const router = await mountAt('/clients?page=9')

    await expect.poll(() => params().offset).toBe(50)
    await expect.poll(() => router.currentRoute.value.query.page).toBe('2')
  })
})
