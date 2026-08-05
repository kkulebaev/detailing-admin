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
import { buildMonthOptions, currentMonthKey, MONTH_NAMES } from '@/lib/month-options'
import { useAnalyticsOverviewQuery } from '@/lib/queries'
import type { GetApiAnalyticsOverviewParams } from '@/lib/analytics-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartCrosshair, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

// ── Period ────────────────────────────────────────────────────────────────
// Unlike BookingsPage, the period here has no «all months» state — the API
// requires both `from` and `to`, so the pickers always hold a value and
// default to the current month.
const monthOptions = buildMonthOptions()

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

function monthRange(key: string): [CalendarDate, CalendarDate] {
  const [y, m] = key.split('-').map(Number)
  return [new CalendarDate(y, m, 1), new CalendarDate(y, m, lastDayOfMonth(y, m))]
}

const [initFrom, initTo] = monthRange(currentMonthKey())
// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it).
const dateFromCal = shallowRef<DateValue>(initFrom)
const dateToCal = shallowRef<DateValue>(initTo)

// Used to collapse the range popover's trigger label back to «Месяц ГГГГ»
// when the picked range happens to span exactly one calendar month.
function monthKeyOf(from: DateValue, to: DateValue): string | null {
  if (from.day !== 1 || from.year !== to.year || from.month !== to.month) return null
  if (to.day !== lastDayOfMonth(to.year, to.month)) return null
  return `${from.year}-${String(from.month).padStart(2, '0')}`
}

function yearRange(year: number): [CalendarDate, CalendarDate] {
  return [new CalendarDate(year, 1, 1), new CalendarDate(year, 12, 31)]
}

// Mirrors monthKeyOf for the «ГГГГ» label: a full Jan 1 → Dec 31 span reads
// back as a year.
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

// Quick presets: current month and the two before it, each labelled by its
// month name («Август»/«Июль»/…), plus the current year («2026»).
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

// ── Range popover ────────────────────────────────────────────────────────
// The trigger label collapses to «Месяц ГГГГ» / «ГГГГ» when the range is
// exactly a calendar month/year, otherwise it shows both bounds.
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
// Pending selection lives apart from dateFromCal/dateToCal so a half-made
// range (only `start` picked) never reaches `params` and fires a request —
// only a complete range gets committed, right below.
const pendingRange = shallowRef<DateRange>({ start: dateFromCal.value, end: dateToCal.value })

watch(rangeOpen, (open) => {
  // Re-seed the pending range from the applied one each time the popover
  // opens, so a dismissed in-progress pick doesn't leak into the next open.
  if (open) pendingRange.value = { start: dateFromCal.value, end: dateToCal.value }
})

watch(
  pendingRange,
  (r) => {
    if (!r.start || !r.end) return
    // Re-seeding on open sets pendingRange equal to the applied range; without
    // this guard that echo would immediately commit and slam the popover shut
    // the moment it opens. Only a range that actually differs closes it.
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

// Tabs emits the raw StringOrNumber the reka-ui primitive accepts; narrow it
// back to the enum instead of trusting the cast.
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

// Skeleton only on the very first load — background refetches keep the
// previous period's numbers on screen (placeholderData), so `loading` is
// false then.
const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

// Delay the skeleton so a fast load doesn't flash it.
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

// ── KPI row ──────────────────────────────────────────────────────────────
// «Записей» (bookingsCount, all statuses) and «Средний чек» (completedCount,
// only «Выдана») are deliberately different denominators — kept apart with
// their own subtitle so volume never reads as revenue.
const revenueTotal = computed(() => overview.value?.revenue.total ?? 0)
const avgCheck = computed(() => overview.value?.revenue.avgCheck ?? 0)
const bookingsCount = computed(() => overview.value?.revenue.bookingsCount ?? 0)
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

// ── Revenue chart ────────────────────────────────────────────────────────
// series is zero-filled server-side across the whole period, so it's never
// empty for a non-empty range — no separate empty-state needed here.
const series = computed<AnalyticsSeriesPoint[]>(() => overview.value?.revenue.series ?? [])

const chartConfig: ChartConfig = {
  revenue: { label: 'Выручка', color: 'var(--chart-1)' },
}

// unovis wants a numeric X — plot by bucket index and format the tick from
// the corresponding series entry instead of parsing dates in the accessor.
function xAccessor(_d: AnalyticsSeriesPoint, i: number): number {
  return i
}

function yAccessor(d: AnalyticsSeriesPoint): number {
  return d.revenue
}

// The Y axis's native SVG tick text is suppressed: its numbers are drawn
// instead as an HTML overlay positioned inside the plot, so the chart keeps
// a small left margin instead of a wide label gutter (see below).
const noTick = () => ''

// ── X axis ticks ─────────────────────────────────────────────────────────
// A handful of evenly spaced bucket labels below the plot, not one per data
// point (day granularity can have 30+ buckets). Fewer on narrow viewports so
// labels don't crowd; `tickTextHideOverlapping` below is a second line of
// defence for whatever count still doesn't fit.
const isDesktopViewport = useMediaQuery('(min-width: 640px)')
const xTickCount = computed(() => (isDesktopViewport.value ? 6 : 4))

// Picks `count` indices spread evenly across [0, n-1] (the same index domain
// xAccessor plots on). Falls back to every index once n <= count, and dedupes
// the rounded positions so a small n never yields repeated ticks.
function evenIndices(n: number, count: number): number[] {
  if (n <= 0) return []
  if (n <= count) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (count - 1)
  return Array.from(new Set(Array.from({ length: count }, (_, i) => Math.round(i * step))))
}

const xTickValues = computed(() => evenIndices(series.value.length, xTickCount.value))

// Short form for the axis gutter — formatBucketLabel() below (used in the
// hover tooltip) spells out a week's full range or "Месяц ГГГГ", too wide to
// repeat several times in a row here.
function formatXTickLabel(bucket: string, g: AnalyticsGranularity): string {
  const [y, m, d] = bucket.split('-').map(Number)
  if (g === 'month') return `${String(m).padStart(2, '0')}.${y}`
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

function xTickFormat(i: number): string {
  const point = series.value[i]
  return point ? formatXTickLabel(point.bucket, granularity.value) : ''
}

// unovis center-anchors tick labels by default, which is fine for interior
// ticks but lets the first/last one straddle the domain edge — with the
// 7-char month format ("01.2026") that pushes past the plot's 8px side
// margin and gets clipped by the SVG's own overflow:hidden. Anchoring the
// edge ticks inward keeps every character on-canvas.
function xTickTextAlign(_v: number, i: number, values: number[]): 'left' | 'center' | 'right' {
  if (i === 0) return 'left'
  if (i === values.length - 1) return 'right'
  return 'center'
}

// Rounds a raw step to a "nice" 1/2/5/10 × 10^n multiple, mirroring d3's
// tick-rounding heuristic (sqrt(50)/sqrt(10)/sqrt(2) thresholds) — this
// keeps the axis from picking awkward values like "21750".
function niceStep(rawStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const factor = residual >= Math.sqrt(50) ? 10 : residual >= Math.sqrt(10) ? 5 : residual >= Math.sqrt(2) ? 2 : 1
  return factor * magnitude
}

const Y_TICK_COUNT = 5

// Computed once here (instead of relying on unovis's own auto-ticking) so
// the same values drive both the VisAxis grid lines and the HTML label
// overlay below — they'd drift apart otherwise. `domainMax` gets ~10%
// headroom above the top tick so the line and its label never get clipped
// against the top of the plot.
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

// Compact form for the in-chart labels ("80 тыс.") — the full space-grouped
// formatAmount() reads too wide sitting inside the plot area.
function formatCompactAmount(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${trimTrailingZero(n / 1_000_000)} млн`
  if (abs >= 1_000) return `${trimTrailingZero(n / 1_000)} тыс.`
  return formatAmount(n)
}

function trimTrailingZero(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace('.', ',')
}

// ── Hover tooltip ────────────────────────────────────────────────────────
// `bucket` is 'YYYY-MM-DD' for day/week (week is its Monday) or 'YYYY-MM' for
// month — format each into a reader-friendly label for the crosshair tooltip.
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

// Crosshair snaps to the nearest AnalyticsSeriesPoint and hands it here as-is
// (see xAccessor/yAccessor above — same accessors the crosshair inherits from
// VisLine). Colors come from the same design tokens ChartTooltipContent uses,
// so the tooltip reads correctly in both themes.
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

// ── Clients block ────────────────────────────────────────────────────────
const clients = computed(() => overview.value?.clients ?? null)
const repeatRateLabel = computed(() => {
  const r = clients.value?.repeatRate
  return r == null ? '—' : `${r}%`
})

const topRows = computed<AnalyticsTopClient[]>(() => clients.value?.topBySum ?? [])
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <h1 class="text-2xl font-semibold">Аналитика</h1>
    </header>

    <!-- Filters -->
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
            <div class="grid grid-cols-2 gap-1 border-b border-border p-2 sm:flex sm:flex-col sm:border-r sm:border-b-0">
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
              <Button variant="ghost" size="sm" class="justify-start" @click="pickPreset(() => applyYear(currentYear))">
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
      <!-- Skeleton mirrors the loaded layout's card chrome (header + padded
           content) so its height matches the real sections — a bare-block
           placeholder would be shorter than the chart/KPI cards and jerk the
           page down on first load. -->
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
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div v-for="i in 3" :key="i" class="space-y-2">
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
        <!-- KPI row -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Выручка</CardDescription>
              <CardTitle class="text-2xl tabular-nums">{{ formatAmount(revenueTotal) }} ₽</CardTitle>
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
              <p class="text-xs text-muted-foreground">
                Выручка / количество выданных машин
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Записей за период</CardDescription>
              <CardTitle class="text-2xl tabular-nums">{{ bookingsCount }}</CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-xs text-muted-foreground">
                Учитывает все статусы
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Δ к предыдущему периоду</CardDescription>
              <CardTitle class="flex items-center gap-1.5 text-2xl tabular-nums" :class="deltaClass">
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

        <!-- Revenue chart -->
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
                <!-- autoMargin (unovis default: true) grows the bottom margin
                     further to fit the X axis's tick text as soon as it
                     stops being empty, silently overriding `margin.bottom`
                     below and desyncing it from the Y overlay's `bottom-7`
                     inset. Disabling it keeps `margin` authoritative. -->
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
              <!-- Mirrors VisXYContainer's own margin so the labels line up
                   with the plot area exactly, sitting just above their
                   gridline instead of in a dedicated axis gutter. `bottom-7`
                   (28px) matches the container's larger bottom margin, which
                   makes room for the X axis's own tick labels below the plot
                   — top/left/right stay at `inset-*-2` (8px), matching those
                   margins unchanged. `bg-card` backs each label so a data
                   point crossing near the left edge (common with
                   day-granularity data) doesn't run the line straight
                   through the digits. -->
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

        <!-- Clients -->
        <Card class="mt-4">
          <CardHeader>
            <CardTitle>Клиенты</CardTitle>
          </CardHeader>
          <CardContent class="space-y-6">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

            <!-- Visually separate from new/returning: this counts bookings
                 without a linked client, not a third client category. -->
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
                    <TableCell class="px-2 tabular-nums sm:px-4">{{ formatPhone(row.phone) }}</TableCell>
                    <TableCell class="px-2 text-right tabular-nums sm:px-4">
                      {{ formatAmount(row.sum) }}
                    </TableCell>
                    <TableCell class="px-2 text-right tabular-nums sm:px-4">{{ row.visits }}</TableCell>
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
