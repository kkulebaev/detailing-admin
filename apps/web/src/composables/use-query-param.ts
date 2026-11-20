import { watch, type Ref, type WatchSource } from 'vue'
import { useRoute, useRouter, type Router } from 'vue-router'

export interface QueryParamOptions<T> {
  // undefined — значение из адреса не подходит, и вместо него берется defaultValue.
  parse: (raw: string) => T | undefined
  serialize: (value: T) => string
  // Что значит отсутствие параметра. Функция, а не значение: у «текущего месяца»
  // и «сегодня» оно со временем меняется.
  defaultValue: () => T
  // Маршруты, на которых параметр принадлежит странице. По умолчанию — тот, на
  // котором ее смонтировали; ClientsPage живет сразу на двух.
  routes?: readonly string[]
}

interface RouterSync {
  // Только накопленные правки, а не снимок адреса: адрес мог смениться, пока
  // правки ждали отправки, и снимок вернул бы его назад.
  patch: Record<string, string | undefined>
  routes: Set<unknown>
  // Правки, уже ушедшие в навигации, которые еще в пути. Новая навигация отменяет
  // предыдущую, поэтому каждая следующая несет и их, иначе они бы потерялись.
  inFlightPatch: Record<string, string | undefined>
  scheduled: boolean
  inFlight: number
  // Адреса своих навигаций в пути: их эхо в route.query — не внешняя смена.
  sent: Set<string>
  // Навигация, которая сейчас идет через guard-ы, своя или чужая.
  navigating: string | null
}

// Несколько фильтров меняются в одном тике (сброс, клик по сайдбару), а
// router.replace асинхронный: каждый, кто разворачивает route.query сам, затер бы
// соседей. Поэтому правки копятся на роутер и уходят одной навигацией.
const syncs = new WeakMap<Router, RouterSync>()
// Роутеры, в которых прямо сейчас применяются значения из адреса; см. watchFilters.
const applyingFromUrl = new WeakSet<Router>()

function syncFor(router: Router): RouterSync {
  let sync = syncs.get(router)
  if (sync) return sync
  const created: RouterSync = {
    patch: {},
    inFlightPatch: {},
    routes: new Set(),
    scheduled: false,
    inFlight: 0,
    sent: new Set(),
    navigating: null,
  }
  router.beforeEach((to) => {
    created.navigating = to.fullPath
  })
  // afterEach приходит и на отмененную навигацию, уже после старта новой, поэтому
  // снимаем отметку, только если она про эту навигацию.
  router.afterEach((to) => {
    if (created.navigating === to.fullPath) created.navigating = null
  })
  router.onError(() => {
    created.navigating = null
  })
  syncs.set(router, created)
  return created
}

function patchQuery(
  router: Router,
  routes: readonly unknown[],
  patch: Record<string, string | undefined>,
) {
  const sync = syncFor(router)
  for (const r of routes) sync.routes.add(r)
  Object.assign(sync.patch, patch)
  if (sync.scheduled) return
  sync.scheduled = true
  queueMicrotask(() => {
    sync.scheduled = false
    const changes = sync.patch
    sync.patch = {}
    const owners = [...sync.routes]
    sync.routes.clear()
    const route = router.currentRoute.value
    const nav = sync.navigating
    // Страницу покидают или уже покинули: replace отменил бы переход пользователя,
    // а чужому маршруту ее параметры ни к чему.
    const foreignNav = nav !== null && !sync.sent.has(nav)
    if (foreignNav || !owners.includes(route.name)) return
    const query = { ...route.query, ...sync.inFlightPatch, ...changes }
    const target = router.resolve({ query }).fullPath
    if (target === route.fullPath) return
    sync.inFlight += 1
    sync.sent.add(target)
    Object.assign(sync.inFlightPatch, changes)
    // replace, а не push: фильтр — не шаг, к которому возвращаются «Назад».
    void router.replace({ query }).finally(() => {
      sync.inFlight -= 1
      if (sync.inFlight > 0) return
      sync.sent.clear()
      sync.inFlightPatch = {}
    })
  })
}

// Держит `source` и параметр `key` адреса в согласии, чтобы перезагрузка и
// присланная ссылка открывали страницу с теми же фильтрами. Значение по умолчанию
// в адрес не пишется. Вызывать до watch-ей, которые реагируют на `source`:
// значение из адреса ставится сразу и не должно их будить.
export function useQueryParam<T>(key: string, source: Ref<T>, options: QueryParamOptions<T>) {
  const route = useRoute()
  const router = useRouter()
  // Сразу, а не при первой правке: переход, начатый до нее, тоже нужно видеть.
  syncFor(router)
  const routes: readonly unknown[] = options.routes ?? [route.name]
  const owns = () => routes.includes(route.name)

  const read = (raw: unknown): T =>
    (typeof raw === 'string' ? options.parse(raw) : undefined) ?? options.defaultValue()
  const toQuery = (value: T): string | undefined => {
    const s = options.serialize(value)
    return s === options.serialize(options.defaultValue()) ? undefined : s
  }

  const initial = read(route.query[key])
  source.value = initial
  // Негодное значение (старая ссылка, месяц, ушедший из окна) убираем и из адреса,
  // иначе он показывал бы не то, что на экране.
  const raw = route.query[key]
  if (raw !== undefined && raw !== toQuery(initial)) {
    patchQuery(router, routes, { [key]: toQuery(initial) })
  }

  watch(source, (value) => {
    if (!owns()) return
    const next = toQuery(value)
    if (route.query[key] !== next) patchQuery(router, routes, { [key]: next })
  })

  // Адрес меняется и снаружи: ссылка в сайдбаре ведет на страницу без параметров,
  // «Вперед»/«Назад» — на прошлый набор фильтров. Эхо своей навигации сюда тоже
  // приходит, но совпадает с `source` и ничего не меняет.
  watch(
    () => route.query[key],
    (value) => {
      if (!owns()) return
      const sync = syncs.get(router)
      // Внешний адрес главнее правок, которые еще не ушли или еще в пути.
      if (sync) {
        delete sync.patch[key]
        delete sync.inFlightPatch[key]
      }
      const next = read(value)
      if (options.serialize(next) === options.serialize(source.value)) return
      applyingFromUrl.add(router)
      queueMicrotask(() => applyingFromUrl.delete(router))
      source.value = next
    },
  )
}

// Как watch, но молчит, когда фильтры пришли из адреса. Иначе сброс страницы при
// смене фильтра затер бы страницу, пришедшую в том же адресе («Назад» на
// `?q=b&page=2` открывал бы первую). Регистрировать после useQueryParam.
export function watchFilters(sources: WatchSource[], onChange: () => void) {
  const router = useRouter()
  watch(sources, () => {
    if (!applyingFromUrl.has(router)) onChange()
  })
}

export function monthParam(options: readonly { value: string }[], defaultValue: () => string) {
  return {
    parse: (raw: string) => (options.some((o) => o.value === raw) ? raw : undefined),
    serialize: (value: string) => value,
    defaultValue,
  } satisfies QueryParamOptions<string>
}

export function pageParam() {
  return {
    parse: (raw: string) => (/^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : undefined),
    serialize: (value: number) => String(value),
    defaultValue: () => 1,
  } satisfies QueryParamOptions<number>
}

export function textParam() {
  return {
    parse: (raw: string) => raw,
    serialize: (value: string) => value,
    defaultValue: () => '',
  } satisfies QueryParamOptions<string>
}

export function enumParam<T extends string>(values: readonly T[], defaultValue: T) {
  return {
    parse: (raw: string) => values.find((v) => v === raw),
    serialize: (value: T) => value,
    defaultValue: () => defaultValue,
  } satisfies QueryParamOptions<T>
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// Строгая проверка дня: «2026-02-30» и нулевой год отвергаются, а не сдвигаются.
export function isIsoDay(raw: string): boolean {
  const m = ISO_DAY.exec(raw)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 2000 || mo < 1 || mo > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

export function isIsoMonth(raw: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(raw)
  return m !== null && Number(m[1]) >= 2000 && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

// Диапазон одной строкой `YYYY-MM-DD..YYYY-MM-DD`: границы проверяются вместе,
// и перевернутый диапазон из старой ссылки не доходит до API.
export function dayRangeParam(defaultValue: () => string) {
  return {
    parse: (raw: string) => {
      const [from, to, ...rest] = raw.split('..')
      if (rest.length > 0 || !from || !to || !isIsoDay(from) || !isIsoDay(to)) return undefined
      return from <= to ? raw : undefined
    },
    serialize: (value: string) => value,
    defaultValue,
  } satisfies QueryParamOptions<string>
}
