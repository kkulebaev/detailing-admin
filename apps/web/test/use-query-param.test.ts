import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import type { Router } from 'vue-router'
import {
  dayRangeParam,
  enumParam,
  isIsoDay,
  monthParam,
  pageParam,
  textParam,
  useQueryParam,
  watchFilters,
} from '@/composables/use-query-param'
import { createTestRouter } from './helpers/router'

const state = {
  mode: ref<'a' | 'b'>('a'),
  q: ref(''),
  page: ref(1),
}

const Page = defineComponent({
  setup() {
    useQueryParam('mode', state.mode, enumParam(['a', 'b'], 'a'))
    useQueryParam('q', state.q, textParam())
    useQueryParam('page', state.page, pageParam())
    // Как на страницах списков: смена фильтра возвращает на первую страницу.
    watchFilters([state.mode, state.q], () => {
      state.page.value = 1
    })
    return () => null
  },
})

async function mountAt(path: string, slowGuardMs?: number): Promise<Router> {
  state.mode.value = 'a'
  state.q.value = ''
  state.page.value = 1
  const router = await createTestRouter(path, { slowGuardMs })
  mount(Page, { global: { plugins: [router] } })
  return router
}

const query = (router: Router) => router.currentRoute.value.query
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

enableAutoUnmount(afterEach)

describe('useQueryParam', () => {
  it('берет значения из адреса при монтировании', async () => {
    await mountAt(`/?mode=b&q=${encodeURIComponent('иван')}&page=3`)

    expect(state.mode.value).toBe('b')
    expect(state.q.value).toBe('иван')
    expect(state.page.value).toBe(3)
  })

  it('негодные значения заменяет умолчанием и убирает из адреса, не трогая чужие', async () => {
    const router = await mountAt('/?mode=zzz&page=0&other=1')

    expect(state.mode.value).toBe('a')
    expect(state.page.value).toBe(1)
    await expect.poll(() => router.currentRoute.value.fullPath).toBe('/?other=1')
  })

  it('несколько правок в одном тике уходят в адрес вместе', async () => {
    const router = await mountAt('/')

    state.mode.value = 'b'
    state.q.value = 'x'
    await expect.poll(() => query(router)).toEqual({ mode: 'b', q: 'x' })

    state.page.value = 2
    await expect.poll(() => query(router)).toEqual({ mode: 'b', q: 'x', page: '2' })

    state.mode.value = 'a'
    await expect.poll(() => query(router)).toEqual({ q: 'x' })
  })

  it('медленная навигация не откатывает значение, выбранное после нее', async () => {
    const router = await mountAt('/', 30)

    state.page.value = 2
    // Первая навигация уже прошла guard-ы и вот-вот применится.
    await sleep(20)
    state.page.value = 3
    await sleep(15)
    expect(state.page.value).toBe(3)
    await expect.poll(() => query(router).page).toBe('3')
    expect(state.page.value).toBe(3)
  })

  it('правка, сделанная пока прошлая еще в пути, не теряет прошлую', async () => {
    const router = await mountAt('/', 30)

    state.q.value = 'x'
    await sleep(10)
    state.mode.value = 'b'

    await expect.poll(() => query(router)).toEqual({ q: 'x', mode: 'b' })
  })

  it('не отменяет переход на другую страницу, начатый раньше записи в адрес', async () => {
    const router = await mountAt('/', 30)

    const leaving = router.push('/other')
    await sleep(5)
    state.q.value = 'x'
    await leaving

    expect(router.currentRoute.value.name).toBe('other')
  })

  it('переход на адрес без параметров возвращает умолчания', async () => {
    const router = await mountAt('/?mode=b&page=4')

    await router.push('/')

    await expect.poll(() => state.mode.value).toBe('a')
    expect(state.page.value).toBe(1)
  })

  it('страница из адреса не сбрасывается фильтром из того же адреса', async () => {
    const router = await mountAt('/')

    await router.push('/?q=b&page=2')

    await expect.poll(() => state.q.value).toBe('b')
    expect(state.page.value).toBe(2)
    expect(query(router)).toEqual({ q: 'b', page: '2' })
  })

  it('смена фильтра пользователем по-прежнему сбрасывает страницу', async () => {
    const router = await mountAt('/?page=3')

    state.q.value = 'x'

    await expect.poll(() => query(router)).toEqual({ q: 'x' })
    expect(state.page.value).toBe(1)
  })
})

describe('разбор значений', () => {
  it('день проверяется строго', () => {
    expect(isIsoDay('2026-02-28')).toBe(true)
    expect(isIsoDay('2028-02-29')).toBe(true)
    expect(isIsoDay('2026-02-29')).toBe(false)
    expect(isIsoDay('2026-13-01')).toBe(false)
    expect(isIsoDay('0000-01-01')).toBe(false)
    expect(isIsoDay('2026-1-01')).toBe(false)
  })

  it('диапазон дней отвергает перевернутые и битые границы', () => {
    const p = dayRangeParam(() => '')
    expect(p.parse('2026-01-01..2026-03-31')).toBe('2026-01-01..2026-03-31')
    expect(p.parse('2026-03-01..2026-03-01')).toBe('2026-03-01..2026-03-01')
    expect(p.parse('2026-03-31..2026-01-01')).toBeUndefined()
    expect(p.parse('2026-02-30..2026-03-01')).toBeUndefined()
    expect(p.parse('2026-01-01')).toBeUndefined()
    expect(p.parse('2026-01-01..2026-02-01..2026-03-01')).toBeUndefined()
  })

  it('месяц принимается только из окна выбора', () => {
    const p = monthParam([{ value: '2026-11' }, { value: '2026-10' }], () => '2026-11')
    expect(p.parse('2026-10')).toBe('2026-10')
    expect(p.parse('2025-01')).toBeUndefined()
  })
})
