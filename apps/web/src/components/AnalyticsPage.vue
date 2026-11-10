<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Calendar as CalendarIcon, Minus, TrendingDown, TrendingUp } from '@lucide/vue'
import type { DateRange, DateValue } from 'reka-ui'
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'
import { useMediaQuery } from '@vueuse/core'
import { VisAxis, VisLine, VisXYContainer } from '@unovis/vue'
import type {
  AnalyticsGranularity,
  AnalyticsSeriesPoint,
  AnalyticsTopClient,
} from '@detailing-admin/shared'
import { calToDdmmyyyy } from '@/lib/date'
import { formatPhone } from '@/lib/phone'
import { buildMonthOptions, MONTH_NAMES } from '@/lib/month-options'
import { useAnalyticsOverviewQuery } from '@/lib/queries'
import type { GetApiAnalyticsOverviewParams } from '@/lib/analytics-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartCrosshair,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RangeCalendar } from '@/components/ui/range-calendar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ── Период ────────────────────────────────────────────────────────────────
// В отличие от BookingsPage, здесь у периода нет состояния «все месяцы» — API
// требует и `from`, и `to`, поэтому в пикерах всегда есть значение, а по
// умолчанию стоит текущий месяц.
const monthOptions = buildMonthOptions()

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

function monthRange(key: string): [CalendarDate, CalendarDate] {
  const [y, m] = key.split('-').map(Number)
  return [new CalendarDate(y, m, 1), new CalendarDate(y, m, lastDayOfMonth(y, m))]
}

// Период по умолчанию — с начала месяца (1-е число текущего месяца → сегодня), а не
// весь календарный месяц: по оставшимся дням отчитываться ещё не о чем.
const initTo = today(getLocalTimeZone())
const initFrom = new CalendarDate(initTo.year, initTo.month, 1)
// shallowRef сохраняет #private-поле CalendarDate (UnwrapRef из Vue его срезает).
const dateFromCal = shallowRef<DateValue>(initFrom)
const dateToCal = shallowRef<DateValue>(initTo)

// Нужно, чтобы свернуть подпись триггера поповера обратно в «Месяц ГГГГ»,
// когда выбранный диапазон ровно совпадает с одним календарным месяцем.
function monthKeyOf(from: DateValue, to: DateValue): string | null {
  if (from.day !== 1 || from.year !== to.year || from.month !== to.month) return null
  if (to.day !== lastDayOfMonth(to.year, to.month)) return null
  return `${from.year}-${String(from.month).padStart(2, '0')}`
}

function yearRange(year: number): [CalendarDate, CalendarDate] {
  return [new CalendarDate(year, 1, 1), new CalendarDate(year, 12, 31)]
}

// Аналог monthKeyOf для подписи «ГГГГ»: полный диапазон 1 янв → 31 дек
// читается как год.
function yearKeyOf(from: DateValue, to: DateValue): string | null {
  if (from.day !== 1 || from.month !== 1) return null
  if (to.month !== 12 || to.day !== 31 || from.year !== to.year) return null
  return String(from.year)
}

function applyMonth(key: string) {
  const [from, to] = monthRange(key)
  dateFromCal.value = from
  dateToCal.value = to
}
function applyYear(year: number) {
  const [from, to] = yearRange(year)
  dateFromCal.value = from
  dateToCal.value = to
}

// Быстрые пресеты: текущий месяц и два предыдущих, каждый подписан названием
// месяца («Август»/«Июль»/…), плюс текущий год («2026»).
function monthKeyOffset(back: number): string {
  const t = today(getLocalTimeZone())
  const d = new CalendarDate(t.year, t.month, 1).subtract({ months: back })
  return `${d.year}-${String(d.month).padStart(2, '0')}`
}
const monthPresets = [0, 1, 2].map((back) => {
  const key = monthKeyOffset(back)
  return { key, label: MONTH_NAMES[Number(key.split('-')[1]) - 1] }
})
const currentYear = today(getLocalTimeZone()).year

// ── Поповер диапазона ────────────────────────────────────────────────────
// Подпись триггера сворачивается в «Месяц ГГГГ» / «ГГГГ», когда диапазон ровно
// равен календарному месяцу/году, иначе показывает обе границы.
const rangeLabel = computed(() => {
  const monthKey = monthKeyOf(dateFromCal.value, dateToCal.value)
  if (monthKey) {
    return monthOptions.find((o) => o.value === monthKey)?.label ?? calToDdmmyyyy(dateFromCal.value)
  }
  const yearKey = yearKeyOf(dateFromCal.value, dateToCal.value)
  if (yearKey) return yearKey
  return `${calToDdmmyyyy(dateFromCal.value)} – ${calToDdmmyyyy(dateToCal.value)}`
})

const rangeOpen = ref(false)
// Незавершённый выбор хранится отдельно от dateFromCal/dateToCal, чтобы
// недоделанный диапазон (выбран только `start`) не попал в `params` и не
// отправил запрос — фиксируется только полный диапазон, чуть ниже.
const pendingRange = shallowRef<DateRange>({ start: dateFromCal.value, end: dateToCal.value })

watch(rangeOpen, (open) => {
  // При каждом открытии поповера заново заполняем pending-диапазон из применённого,
  // чтобы брошенный на полпути выбор не просочился в следующее открытие.
  if (open) pendingRange.value = { start: dateFromCal.value, end: dateToCal.value }
})

watch(
  pendingRange,
  (r) => {
    if (!r.start || !r.end) return
    // Перезаполнение при открытии делает pendingRange равным применённому; без
    // этой проверки такое эхо сразу закоммитилось бы и захлопнуло поповер
    // в момент открытия. Закрывает его только реально отличающийся диапазон.
    if (r.start.compare(dateFromCal.value) === 0 && r.end.compare(dateToCal.value) === 0) return
    dateFromCal.value = r.start
    dateToCal.value = r.end
    rangeOpen.value = false
  },
  { deep: true },
)

function pickPreset(apply: () => void) {
  apply()
  rangeOpen.value = false
}

const GRANULARITIES = ['day', 'week', 'month'] as const satisfies readonly AnalyticsGranularity[]
const granularity = ref<AnalyticsGranularity>('day')

// Tabs отдаёт сырой StringOrNumber, который принимает примитив reka-ui; сужаем
// его обратно до enum, а не доверяем приведению типа.
function onGranularityChange(v: string | number) {
  const next = GRANULARITIES.find((g) => g === String(v))
  if (next) granularity.value = next
}

const params = computed<GetApiAnalyticsOverviewParams>(() => ({
  from: calToDdmmyyyy(dateFromCal.value),
  to: calToDdmmyyyy(dateToCal.value),
  granularity: granularity.value,
}))

const { data: queryData, error: queryError, asyncStatus } = useAnalyticsOverviewQuery(params)

// Скелетон только при самой первой загрузке — фоновые перезапросы оставляют
// на экране цифры предыдущего периода (placeholderData), поэтому `loading`
// в этот момент false.
const loading = computed(() => asyncStatus.value === 'loading' && queryData.value === undefined)

// Показываем скелетон с задержкой, чтобы он не мелькал при быстрой загрузке.
const showSkeleton = ref(false)
let skeletonTimer: ReturnType<typeof setTimeout> | undefined
watch(
  loading,
  (isLoading) => {
    clearTimeout(skeletonTimer)
    if (isLoading) skeletonTimer = setTimeout(() => (showSkeleton.value = true), 200)
    else showSkeleton.value = false
  },
  { immediate: true },
)
onUnmounted(() => clearTimeout(skeletonTimer))

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке аналитики'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить аналитику'
})

const overview = computed(() => {
  const r = queryData.value
  return r?.ok ? r : null
})

// ── Ряд KPI ──────────────────────────────────────────────────────────────
// У «Выручка», «Средний чек» и «Кол-во выдач» общий знаменатель только по «Выдана»
// (completedCount) — выручка и объём считаются на одной базе.
const revenueTotal = computed(() => overview.value?.revenue.total ?? 0)
const avgCheck = computed(() => overview.value?.revenue.avgCheck ?? 0)
const completedCount = computed(() => overview.value?.revenue.completedCount ?? 0)
const revenuePct = computed(() => overview.value?.revenue.delta.revenuePct ?? null)
const prevTotal = computed(() => overview.value?.revenue.delta.prevTotal ?? 0)

function formatAmount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function formatPct(pct: number | null): string {
  if (pct === null) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct}%`
}

const deltaClass = computed(() => {
  const pct = revenuePct.value
  if (pct === null || pct === 0) return 'text-muted-foreground'
  return pct > 0 ? 'text-success' : 'text-destructive'
})

const deltaIcon = computed(() => {
  const pct = revenuePct.value
  if (pct === null || pct === 0) return Minus
  return pct > 0 ? TrendingUp : TrendingDown
})

// ── График выручки ───────────────────────────────────────────────────────
// series дозаполняется нулями на сервере по всему периоду, поэтому для непустого
// диапазона он никогда не пуст — отдельное пустое состояние здесь не нужно.
const series = computed<AnalyticsSeriesPoint[]>(() => overview.value?.revenue.series ?? [])

const chartConfig: ChartConfig = {
  revenue: { label: 'Выручка', color: 'var(--chart-1)' },
}

// unovis нужен числовой X — строим по индексу бакета и форматируем тик по
// соответствующему элементу series, а не парсим даты в accessor.
function xAccessor(_d: AnalyticsSeriesPoint, i: number): number {
  return i
}

function yAccessor(d: AnalyticsSeriesPoint): number {
  return d.revenue
}

// Нативный SVG-текст тиков оси Y подавлен: числа вместо этого рисуются
// HTML-оверлеем внутри области графика, так что у графика остаётся узкий
// левый отступ, а не широкое поле под подписи (см. ниже).
const noTick = () => ''

// ── Тики оси X ───────────────────────────────────────────────────────────
// Несколько равномерно расставленных подписей бакетов под графиком, а не по одной
// на точку (при дневной гранулярности бакетов может быть 30+). На узких экранах
// их меньше, чтобы подписи не толпились; `tickTextHideOverlapping` ниже — вторая
// линия защиты для того количества, что всё равно не влезает.
const isDesktopViewport = useMediaQuery('(min-width: 640px)')
const xTickCount = computed(() => (isDesktopViewport.value ? 6 : 4))

// Выбирает `count` индексов, равномерно распределённых по [0, n-1] (тот же домен
// индексов, по которому строит xAccessor). При n <= count берёт все индексы и
// убирает дубли округлённых позиций, чтобы при малом n тики не повторялись.
function evenIndices(n: number, count: number): number[] {
  if (n <= 0) return []
  if (n <= count) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (count - 1)
  return Array.from(new Set(Array.from({ length: count }, (_, i) => Math.round(i * step))))
}

const xTickValues = computed(() => evenIndices(series.value.length, xTickCount.value))

// Короткая форма для подписей оси — formatBucketLabel() ниже (используется в
// тултипе при наведении) выписывает полный диапазон недели или «Месяц ГГГГ»,
// что слишком широко, чтобы повторять несколько раз подряд.
function formatXTickLabel(bucket: string, g: AnalyticsGranularity): string {
  const [y, m, d] = bucket.split('-').map(Number)
  if (g === 'month') return `${String(m).padStart(2, '0')}.${y}`
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

function xTickFormat(i: number): string {
  const point = series.value[i]
  return point ? formatXTickLabel(point.bucket, granularity.value) : ''
}

// unovis по умолчанию центрирует подписи тиков: для внутренних тиков это нормально,
// но первый/последний вылезают за край домена — с 7-символьным форматом месяца
// («01.2026») это выходит за 8px бокового отступа графика и обрезается
// собственным overflow:hidden у SVG. Привязка крайних тиков внутрь оставляет
// все символы на холсте.
function xTickTextAlign(_v: number, i: number, values: number[]): 'left' | 'center' | 'right' {
  if (i === 0) return 'left'
  if (i === values.length - 1) return 'right'
  return 'center'
}

// Округляет сырой шаг до «красивого» кратного 1/2/5/10 × 10^n, повторяя
// эвристику округления тиков из d3 (пороги sqrt(50)/sqrt(10)/sqrt(2)) — так
// ось не выбирает неудобные значения вроде «21750».
function niceStep(rawStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const factor =
    residual >= Math.sqrt(50)
      ? 10
      : residual >= Math.sqrt(10)
        ? 5
        : residual >= Math.sqrt(2)
          ? 2
          : 1
  return factor * magnitude
}

const Y_TICK_COUNT = 5

// Считается один раз здесь (а не через собственный авто-тикинг unovis), чтобы
// одни и те же значения управляли и линиями сетки VisAxis, и HTML-оверлеем
// подписей ниже — иначе они разъедутся. `domainMax` получает ~10% запаса над
// верхним тиком, чтобы линия и её подпись не обрезались о верх
// области графика.
const yScale = computed(() => {
  const maxRevenue = Math.max(0, ...series.value.map((d) => d.revenue))
  const step = niceStep(Math.max(maxRevenue, 1) / (Y_TICK_COUNT - 1))
  const niceMax = step * (Y_TICK_COUNT - 1)
  const domainMax = Math.max(niceMax, maxRevenue) * 1.1
  const ticks = Array.from({ length: Y_TICK_COUNT }, (_, i) => {
    const value = i * step
    return { value, topPct: (1 - value / domainMax) * 100, label: formatCompactAmount(value) }
  })
  return { domainMax, ticks }
})
const yTickValues = computed(() => yScale.value.ticks.map((t) => t.value))

// Компактная форма для подписей внутри графика («80 тыс.») — полный
// formatAmount() с разбиением пробелами слишком широк внутри области графика.
function formatCompactAmount(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${trimTrailingZero(n / 1_000_000)} млн`
  if (abs >= 1_000) return `${trimTrailingZero(n / 1_000)} тыс.`
  return formatAmount(n)
}

function trimTrailingZero(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',')
}

// ── Тултип при наведении ─────────────────────────────────────────────────
// `bucket` — это 'YYYY-MM-DD' для дня/недели (неделя — её понедельник) или 'YYYY-MM'
// для месяца — форматируем каждый в понятную подпись для тултипа crosshair.
function formatDdmm(y: number, m: number, d: number): string {
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`
}

function formatBucketLabel(bucket: string, g: AnalyticsGranularity): string {
  if (g === 'month') {
    const [y, m] = bucket.split('-').map(Number)
    return `${MONTH_NAMES[m - 1]} ${y}`
  }
  if (g === 'week') {
    const [y, m, d] = bucket.split('-').map(Number)
    const monday = new Date(Date.UTC(y, m - 1, d))
    const sunday = new Date(monday)
    sunday.setUTCDate(sunday.getUTCDate() + 6)
    return `${formatDdmm(y, m, d)} – ${formatDdmm(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate())}`
  }
  const [y, m, d] = bucket.split('-').map(Number)
  return formatDdmm(y, m, d)
}

// Crosshair примагничивается к ближайшему AnalyticsSeriesPoint и передаёт его сюда
// как есть (см. xAccessor/yAccessor выше — те же accessor'ы crosshair наследует от
// VisLine). Цвета берутся из тех же дизайн-токенов, что и в ChartTooltipContent,
// поэтому тултип корректно выглядит в обеих темах.
function crosshairTemplate(d: AnalyticsSeriesPoint): string {
  return `
    <div class="min-w-32 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div class="font-medium">${formatBucketLabel(d.bucket, granularity.value)}</div>
      <div class="mt-1 flex items-center justify-between gap-3">
        <span class="text-muted-foreground">Выручка</span>
        <span class="font-mono font-medium tabular-nums">${formatAmount(d.revenue)} ₽</span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-muted-foreground">Записей</span>
        <span class="font-mono tabular-nums">${d.count}</span>
      </div>
    </div>
  `
}

// ── Блок клиентов ────────────────────────────────────────────────────────
const clients = computed(() => overview.value?.clients ?? null)
// Только клиенты с привязкой (новые + вернувшиеся); noClientCount — это записи без
// привязанного клиента, а не группа клиентов, поэтому в итог он не входит.
const totalClients = computed(() => {
  const c = clients.value
  return c ? c.newCount + c.returningCount : 0
})
const repeatRateLabel = computed(() => {
  const r = clients.value?.repeatRate
  return r == null ? '—' : `${r}%`
})

const topRows = computed<AnalyticsTopClient[]>(() => clients.value?.topBySum ?? [])
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-2 sm:p-8">
    <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <h1 class="text-2xl font-semibold">Аналитика</h1>
    </header>

    <!-- Фильтры -->
    <div class="mb-6">
      <Popover v-model:open="rangeOpen">
        <PopoverTrigger as-child>
          <Button variant="outline" size="sm" class="justify-start gap-2 font-normal">
            <CalendarIcon class="size-4" />
            {{ rangeLabel }}
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0" align="start">
          <div class="flex flex-col sm:flex-row">
            <div
              class="grid grid-cols-2 gap-1 border-b border-border p-2 sm:flex sm:flex-col sm:border-r sm:border-b-0"
            >
              <Button
                v-for="p in monthPresets"
                :key="p.key"
                variant="ghost"
                size="sm"
                class="justify-start"
                @click="pickPreset(() => applyMonth(p.key))"
              >
                {{ p.label }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="justify-start"
                @click="pickPreset(() => applyYear(currentYear))"
              >
                {{ currentYear }}
              </Button>
            </div>
            <RangeCalendar v-model="pendingRange" locale="ru-RU" :number-of-months="1" />
          </div>
        </PopoverContent>
      </Popover>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertTitle>Не удалось загрузить аналитику</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <template v-else>
      <!-- Скелетон повторяет обвязку карточек загруженного макета (заголовок +
           контент с отступами), чтобы его высота совпадала с реальными секциями —
           голый блок-заглушка был бы ниже карточек графика/KPI и дёргал бы
           страницу вниз при первой загрузке. -->
      <template v-if="showSkeleton">
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card v-for="i in 4" :key="i">
            <CardHeader>
              <Skeleton class="h-4 w-24" />
              <Skeleton class="h-8 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton class="h-3 w-40" />
            </CardContent>
          </Card>
        </div>

        <Card class="mt-4">
          <CardHeader>
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="space-y-1.5">
                <Skeleton class="h-5 w-48" />
                <Skeleton class="h-4 w-64" />
              </div>
              <Skeleton class="h-9 w-56" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton class="h-80 w-full" />
          </CardContent>
        </Card>

        <Card class="mt-4">
          <CardHeader>
            <Skeleton class="h-5 w-24" />
          </CardHeader>
          <CardContent class="space-y-6">
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div v-for="i in 4" :key="i" class="space-y-2">
                <Skeleton class="h-4 w-20" />
                <Skeleton class="h-6 w-12" />
              </div>
            </div>
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-64 w-full" />
          </CardContent>
        </Card>
      </template>

      <template v-else>
        <!-- Ряд KPI -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Выручка</CardDescription>
              <CardTitle class="text-2xl tabular-nums"
                >{{ formatAmount(revenueTotal) }} ₽</CardTitle
              >
            </CardHeader>
            <CardContent>
              <p class="text-xs text-muted-foreground">По записям со статусом «Выдана»</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Средний чек</CardDescription>
              <CardTitle class="text-2xl tabular-nums">{{ formatAmount(avgCheck) }} ₽</CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-xs text-muted-foreground">Выручка / количество выданных машин</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Количество выдач</CardDescription>
              <CardTitle class="text-2xl tabular-nums">{{ completedCount }}</CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-xs text-muted-foreground">По записям со статусом «Выдана»</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Δ к предыдущему периоду</CardDescription>
              <CardTitle
                class="flex items-center gap-1.5 text-2xl tabular-nums"
                :class="deltaClass"
              >
                <component :is="deltaIcon" class="size-5" />
                {{ formatPct(revenuePct) }}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-xs text-muted-foreground">
                Пред. период: {{ formatAmount(prevTotal) }} ₽
              </p>
            </CardContent>
          </Card>
        </div>

        <!-- График выручки -->
        <Card class="mt-4">
          <CardHeader>
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="space-y-1.5">
                <CardTitle>Выручка по периодам</CardTitle>
                <CardDescription>
                  Только записи со статусом «Выдана», по дате начала записи
                </CardDescription>
              </div>
              <Tabs :model-value="granularity" @update:model-value="onGranularityChange">
                <TabsList aria-label="Группировка выручки">
                  <TabsTrigger value="day">День</TabsTrigger>
                  <TabsTrigger value="week">Неделя</TabsTrigger>
                  <TabsTrigger value="month">Месяц</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            <div v-if="series.length" class="relative">
              <ChartContainer :config="chartConfig" class="h-80" cursor>
                <!-- autoMargin (в unovis по умолчанию true) дополнительно
                     увеличивает нижний отступ под текст тиков оси X, как только
                     тот перестаёт быть пустым, молча перекрывая `margin.bottom`
                     ниже и рассинхронизируя его с отступом `bottom-7` у
                     Y-оверлея. Отключение оставляет главным `margin`. -->
                <VisXYContainer
                  :data="series"
                  :margin="{ top: 8, right: 8, bottom: 28, left: 8 }"
                  :auto-margin="false"
                  :y-domain="[0, yScale.domainMax]"
                >
                  <VisLine :x="xAccessor" :y="yAccessor" color="var(--color-revenue)" />
                  <ChartTooltip />
                  <ChartCrosshair color="var(--color-revenue)" :template="crosshairTemplate" />
                  <VisAxis
                    type="x"
                    position="bottom"
                    :grid-line="true"
                    :tick-line="false"
                    :domain-line="false"
                    :tick-values="xTickValues"
                    :tick-format="xTickFormat"
                    :tick-text-align="xTickTextAlign"
                    :tick-text-hide-overlapping="true"
                  />
                  <VisAxis
                    type="y"
                    position="left"
                    :grid-line="true"
                    :tick-line="false"
                    :domain-line="false"
                    :tick-values="yTickValues"
                    :tick-format="noTick"
                  />
                </VisXYContainer>
              </ChartContainer>
              <!-- Повторяет собственный margin у VisXYContainer, чтобы подписи
                   точно совпадали с областью графика и стояли прямо над своей
                   линией сетки, а не в отдельном поле оси. `bottom-7` (28px)
                   совпадает с увеличенным нижним отступом контейнера, который
                   освобождает место под подписи тиков оси X под графиком —
                   top/left/right остаются `inset-*-2` (8px), как и эти
                   отступы. `bg-card` подложен под каждую подпись, чтобы точка
                   данных у левого края (частое дело при дневной
                   гранулярности) не проводила линию прямо
                   сквозь цифры. -->
              <div class="pointer-events-none absolute inset-x-2 top-2 bottom-7 text-xs">
                <span
                  v-for="tick in yScale.ticks"
                  :key="tick.value"
                  class="absolute left-0 rounded-sm bg-card px-1 tabular-nums text-muted-foreground"
                  :style="{ top: `${tick.topPct}%`, transform: 'translateY(calc(-100% - 4px))' }"
                >
                  {{ tick.label }}
                </span>
              </div>
            </div>
            <p v-else class="text-sm text-muted-foreground">Нет данных за период</p>
          </CardContent>
        </Card>

        <!-- Клиенты -->
        <Card class="mt-4">
          <CardHeader>
            <CardTitle>Клиенты</CardTitle>
          </CardHeader>
          <CardContent class="space-y-6">
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p class="text-sm text-muted-foreground">Всего</p>
                <p class="text-xl font-semibold tabular-nums">{{ totalClients }}</p>
              </div>
              <div>
                <p class="text-sm text-muted-foreground">Новые</p>
                <p class="text-xl font-semibold tabular-nums">{{ clients?.newCount ?? 0 }}</p>
              </div>
              <div>
                <p class="text-sm text-muted-foreground">Повторные</p>
                <p class="text-xl font-semibold tabular-nums">{{ clients?.returningCount ?? 0 }}</p>
              </div>
              <div>
                <p class="text-sm text-muted-foreground">Повторные, %</p>
                <p class="text-xl font-semibold tabular-nums">{{ repeatRateLabel }}</p>
              </div>
            </div>

            <!-- Визуально отделено от новых/вернувшихся: здесь считаются записи
                 без привязанного клиента, а не третья категория клиентов. -->
            <div class="rounded-md border border-dashed border-border p-3 text-sm">
              <span class="text-muted-foreground">Без клиента: </span>
              <span class="font-medium tabular-nums">{{ clients?.noClientCount ?? 0 }}</span>
              <span class="text-muted-foreground"> записей за период</span>
            </div>

            <div>
              <p class="mb-3 text-sm font-medium">Топ клиентов по сумме</p>

              <Table container-class="rounded-md border border-border">
                <TableHeader>
                  <TableRow>
                    <TableHead class="px-2 sm:px-4">Клиент</TableHead>
                    <TableHead class="px-2 sm:px-4">Телефон</TableHead>
                    <TableHead class="px-2 text-right sm:px-4">Сумма ₽</TableHead>
                    <TableHead class="px-2 text-right sm:px-4">Визитов</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableEmpty v-if="!topRows.length" :colspan="4">Нет данных за период</TableEmpty>
                  <TableRow v-for="row in topRows" v-else :key="row.clientId">
                    <TableCell class="max-w-32 px-2 whitespace-normal sm:max-w-56 sm:px-4">
                      {{ row.name || '—' }}
                    </TableCell>
                    <TableCell class="px-2 tabular-nums sm:px-4">{{
                      formatPhone(row.phone)
                    }}</TableCell>
                    <TableCell class="px-2 text-right tabular-nums sm:px-4">
                      {{ formatAmount(row.sum) }}
                    </TableCell>
                    <TableCell class="px-2 text-right tabular-nums sm:px-4">{{
                      row.visits
                    }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </template>
    </template>
  </div>
</template>
