<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  Calendar as CalendarIcon,
  Download,
  Inbox,
  Pencil,
  Search,
  SearchX,
  SlidersHorizontal,
  Trash2,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { createReusableTemplate, useLocalStorage } from '@vueuse/core'
import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'
import { READINESS, type BookingRow, type Readiness } from '@detailing-admin/shared'
import { buildMonthOptions } from '@/lib/month-options'
import { calToDdmmyyyy, isoToDdmmyyyy } from '@/lib/date'
import { formatPhone } from '@/lib/phone'
import {
  bookingsExportUrl,
  deleteBooking,
  updateBookingReadiness,
  type GetApiBookingsParams,
} from '@/lib/bookings-api'
import { downloadFile, exportFilename } from '@/lib/download'
import { readinessRowClass } from '@/lib/readiness'
import { useBookingsQuery, useInvalidateBookings, useMastersQuery } from '@/lib/queries'
import { resolveMasterOptions } from '@/lib/master-options'
import { useAuthStore } from '@/stores/auth'
import { useOffsetPagination } from '@/composables/use-offset-pagination'
import BookingDetailsDialog from './BookingDetailsDialog.vue'
import ReadinessPicker from './ReadinessPicker.vue'
import BookingEditDialog from './BookingEditDialog.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import TablePagination from './TablePagination.vue'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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

// reka-ui Select needs a non-empty value, so «Все» rides on a sentinel that the
// params builder maps back to `undefined` (no filter).
const ALL = '__all__'

// The «Сумма» column is admin-only; the API also omits `amount` for non-admins.
const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === 'admin')
// Плотный вид: одна запись занимает две строки таблицы (шапка записи + услуга,
// готовность и действия под ней) вместо тринадцати колонок, живущих только за
// счёт горизонтального скролла. Переключатель ручной и переживает перезагрузку —
// ширина экрана его не переопределяет, потому что на планшете осмысленны обе
// раскладки, а угаданный за пользователя вид сбивает привычку.
const compact = useLocalStorage('bookings:compact', false)

// «#» + employee base of 10; admin adds «Сумма» +«Действия». Компактная запись —
// это одна ячейка на всё (дата, имя, машина, услуга) плюс админская «₽».
const columnCount = computed(() => {
  if (compact.value) return 1
  return isAdmin.value ? 13 : 11
})

const invalidateBookings = useInvalidateBookings()

// ── Inline readiness quick-change (admin) ──────────────────────────────────
// reka-ui Select rejects '', so the «нет статуса» option rides on a sentinel.
const READINESS_NONE = '__none__'
// Optimistic per-row state: the picked value shows immediately while the PATCH
// is in flight, and reverts to the server value on failure.
const readinessOverride = ref<Record<string, Readiness | ''>>({})
const savingReadiness = ref<Record<string, boolean>>({})

function readinessSelectValue(row: BookingRow): string {
  const v = readinessOverride.value[row.id] ?? row.readiness
  return v === '' ? READINESS_NONE : v
}

function clearReadinessPending(id: string) {
  const o = { ...readinessOverride.value }
  delete o[id]
  readinessOverride.value = o
  const s = { ...savingReadiness.value }
  delete s[id]
  savingReadiness.value = s
}

async function onReadinessChange(row: BookingRow, selected: string) {
  // Narrow the select value to a known Readiness (or '') without a type cast.
  const value = selected === READINESS_NONE ? '' : (READINESS.find((r) => r === selected) ?? '')
  if (value === (readinessOverride.value[row.id] ?? row.readiness)) return
  readinessOverride.value = { ...readinessOverride.value, [row.id]: value }
  savingReadiness.value = { ...savingReadiness.value, [row.id]: true }
  try {
    const result = await updateBookingReadiness(row.id, value)
    if (result.ok) {
      await invalidateBookings()
    } else {
      toast.error(
        result.error === 'unavailable' ? result.message : 'Не удалось обновить готовность',
      )
    }
  } catch {
    toast.error('Не удалось обновить готовность')
  } finally {
    // On success the refetched row carries the value; on failure this reverts the
    // select to the server value.
    clearReadinessPending(row.id)
  }
}

const editDialogOpen = ref(false)
const editTarget = ref<BookingRow | null>(null)

// Компактная строка показывает пять полей из тринадцати, остальные живут здесь.
const detailsOpen = ref(false)
// Держим id, а не саму строку: после смены готовности список перезапрашивается,
// и снимок строки в диалоге показывал бы старый статус.
const detailsId = ref<string | null>(null)

const detailsBooking = computed<BookingRow | null>(() => {
  const id = detailsId.value
  if (!id) return null
  const row = items.value.find((r) => r.id === id)
  if (!row) return null
  const pending = readinessOverride.value[id]
  return pending === undefined ? row : { ...row, readiness: pending }
})

function openDetails(row: BookingRow) {
  detailsId.value = row.id
  detailsOpen.value = true
}

// Диалог поверх диалога reka-ui переживает плохо (focus scope второго встаёт до
// того, как первый снял свой), поэтому следующий открываем на следующем тике.
async function onDetailsEdit(row: BookingRow) {
  detailsOpen.value = false
  await nextTick()
  openEdit(row)
}

async function onDetailsDelete(row: BookingRow) {
  detailsOpen.value = false
  await nextTick()
  askDelete(row)
}

const deleteDialogOpen = ref(false)
const deleteTarget = ref<BookingRow | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function openEdit(row: BookingRow) {
  editTarget.value = row
  editDialogOpen.value = true
}

async function onEditSaved() {
  await invalidateBookings()
}

function askDelete(row: BookingRow) {
  deleteTarget.value = row
  deleteError.value = null
  deleteDialogOpen.value = true
}

function onDeleteDialogOpenChange(v: boolean) {
  deleteDialogOpen.value = v
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleteError.value = null
  deleting.value = true
  try {
    const result = await deleteBooking(target.id)
    if (result.ok) {
      toast.success('Запись удалена')
      deleteDialogOpen.value = false
      await invalidateBookings()
      return
    }
    if (result.error === 'not_found') {
      // Already gone — the outcome the user wanted; close and refresh.
      toast.error('Запись уже удалена')
      deleteDialogOpen.value = false
      await invalidateBookings()
      return
    }
    // Real failure — keep the dialog open and surface the reason inside it.
    deleteError.value =
      result.error === 'unavailable' ? result.message : 'Не удалось удалить запись'
  } catch {
    deleteError.value = 'Не удалось удалить запись'
  } finally {
    deleting.value = false
  }
}

// ── Filter state ──────────────────────────────────────────────────────────────
// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it).
const dateFromCal = shallowRef<DateValue | undefined>(undefined)
const dateToCal = shallowRef<DateValue | undefined>(undefined)
const dateFromOpen = ref(false)
const dateToOpen = ref(false)
const masterFilter = ref<string>(ALL)
const readinessFilter = ref<Readiness | typeof ALL>(ALL)
const searchInput = ref('')
// Manual debounce (instead of refDebounced) so `resetFilters` can flush it
// synchronously — otherwise the query keeps the stale search term for 300ms
// after a reset and the table flashes its empty state before real rows load.
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (searchDebounced.value = v), 300)
})
onUnmounted(() => clearTimeout(searchTimer))

const { limit: LIMIT, offset, page, resetToFirstPage } = useOffsetPagination()

const { data: mastersData } = useMastersQuery()
const masterOptions = computed(() =>
  resolveMasterOptions(
    mastersData.value?.ok ? mastersData.value.masters : undefined,
    () => true,
  ),
)

// ── Month quick-filter ──────────────────────────────────────────────────────
// A convenience over the two date pickers: picking a month sets the range to its
// first…last day; the pickers stay the single source of truth (manually tweaking
// them shows «Свой период» in the month select).
const MONTH_CUSTOM = '__custom__'

// Rolling window: 1 month ahead down to 12 back, newest first.
const monthOptions = buildMonthOptions()

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

// Returns the `YYYY-MM` key when the current range spans exactly one whole month.
function monthKeyOf(from?: DateValue, to?: DateValue): string | null {
  if (!from || !to) return null
  if (from.day !== 1 || from.year !== to.year || from.month !== to.month) return null
  if (to.day !== lastDayOfMonth(to.year, to.month)) return null
  return `${from.year}-${String(from.month).padStart(2, '0')}`
}

const monthValue = computed<string>({
  get() {
    const key = monthKeyOf(dateFromCal.value, dateToCal.value)
    if (key) return key
    return dateFromCal.value || dateToCal.value ? MONTH_CUSTOM : ALL
  },
  set(value) {
    if (value === MONTH_CUSTOM) return
    if (value === ALL) {
      dateFromCal.value = undefined
      dateToCal.value = undefined
      return
    }
    const [y, m] = value.split('-').map(Number)
    dateFromCal.value = new CalendarDate(y, m, 1)
    dateToCal.value = new CalendarDate(y, m, lastDayOfMonth(y, m))
  },
})

const params = computed<GetApiBookingsParams>(() => ({
  limit: LIMIT,
  offset: offset.value,
  dateFrom: dateFromCal.value ? calToDdmmyyyy(dateFromCal.value) : undefined,
  dateTo: dateToCal.value ? calToDdmmyyyy(dateToCal.value) : undefined,
  master: masterFilter.value === ALL ? undefined : masterFilter.value,
  readiness: readinessFilter.value === ALL ? undefined : readinessFilter.value,
  q: searchDebounced.value.trim() || undefined,
}))

// Any filter change returns to the first page; paging itself moves `offset`
// directly and is intentionally excluded here.
watch(
  [dateFromCal, dateToCal, masterFilter, readinessFilter, searchDebounced],
  () => {
    resetToFirstPage()
  },
)

const { data: queryData, error: queryError, asyncStatus } = useBookingsQuery(params)

const items = computed<BookingRow[]>(() => {
  const r = queryData.value
  return r?.ok ? r.items : []
})

const total = computed(() => {
  const r = queryData.value
  return r?.ok ? r.total : 0
})

// Skeleton only on the very first load — background refetches keep the previous
// rows visible (placeholderData in useBookingsQuery), so `loading` is false then.
const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

// Delay the skeleton so a fast first load doesn't flash it — only show it if the
// initial load is genuinely slow (>200ms).
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
  if (queryError.value) return 'Сетевая ошибка при загрузке записей'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить список записей'
})

// ── CSV export ──────────────────────────────────────────────────────────────
const exporting = ref(false)

async function onExport() {
  if (exporting.value || total.value === 0) return
  exporting.value = true
  try {
    await downloadFile(bookingsExportUrl(params.value), exportFilename('bookings'))
  } catch {
    toast.error('Не удалось выгрузить CSV')
  } finally {
    exporting.value = false
  }
}


// ── Filter reset ──────────────────────────────────────────────────────────────
// Drives the full-height empty state: stretch the table so the placeholder
// centers vertically in the scroll area instead of clinging under the header.
const isEmpty = computed(
  () =>
    asyncStatus.value !== 'loading' &&
    !showSkeleton.value &&
    !loading.value &&
    items.value.length === 0,
)

// Панель фильтров занимает половину мобильного экрана, поэтому в компактном
// режиме она уезжает в шторку, а снаружи остаётся поиск и кнопка со счётчиком.
const filtersSheetOpen = ref(false)

// Месяц не считаем отдельно: он производный от пары дат.
const activeFilterCount = computed(() => {
  let n = 0
  if (dateFromCal.value || dateToCal.value) n += 1
  if (masterFilter.value !== ALL) n += 1
  if (readinessFilter.value !== ALL) n += 1
  return n
})

// Один набор разметки фильтров на две раскладки — строка на десктопе и шторка на
// мобиле; иначе пять контролов пришлось бы держать в двух местах синхронно.
const [DefineFilters, ReuseFilters] = createReusableTemplate()
const [DefineSearch, ReuseSearch] = createReusableTemplate()

const hasActiveFilters = computed(
  () =>
    !!dateFromCal.value ||
    !!dateToCal.value ||
    masterFilter.value !== ALL ||
    readinessFilter.value !== ALL ||
    searchInput.value.trim() !== '',
)

function resetFilters() {
  dateFromCal.value = undefined
  dateToCal.value = undefined
  masterFilter.value = ALL
  readinessFilter.value = ALL
  searchInput.value = ''
  // Flush the debounce so the query drops the search term this tick, not 300ms
  // later — keeps the empty state from flashing during reset.
  clearTimeout(searchTimer)
  searchDebounced.value = ''
}

function onDateFromSelect(d: DateValue | undefined) {
  dateFromCal.value = d ?? undefined
  dateFromOpen.value = false
}

function onDateToSelect(d: DateValue | undefined) {
  dateToCal.value = d ?? undefined
  dateToOpen.value = false
}

// ── Cell formatting ───────────────────────────────────────────────────────────
// Пробелы вокруг тире дают точку переноса: иначе диапазон — неразрывный токен,
// который вылезает из фиксированной колонки и налезает на соседнюю (Время/Имя).
function formatDateCell(row: BookingRow): string {
  const from = isoToDdmmyyyy(row.dateFrom)
  return row.dateTo ? `${from} – ${isoToDdmmyyyy(row.dateTo)}` : from
}

// Компактный вид роняет год: колонка иначе не влезает в узкий экран, а год почти
// всегда задан фильтром месяца. Полная дата остаётся в `title` ячейки.
function isoToDdmm(iso: string): string {
  const [, m, d] = iso.split('-')
  if (!m || !d) return iso
  return `${d}.${m}`
}

function formatDateCompact(row: BookingRow): string {
  const from = isoToDdmm(row.dateFrom)
  return row.dateTo ? `${from}–${isoToDdmm(row.dateTo)}` : from
}

// Время без пробелов вокруг тире и без прочерка: в компактной строке дата и
// время делят одну строку с именем, каждый лишний символ сдвигает имя.
function formatTimeCompact(row: BookingRow): string {
  if (!row.timeFrom) return ''
  return row.timeTo ? `${row.timeFrom}–${row.timeTo}` : row.timeFrom
}

// Вторая строка компактной записи. `service` многострочный (строка на секцию
// прайса) — в один усечённый рядок он склеивается через « · ». Машина живёт
// строкой выше: по ней запись узнают в первую очередь, имя вторично.
function formatSummaryLine(row: BookingRow): string {
  const service = row.service.split('\n').filter(Boolean).join(' · ')
  return [row.name, service].filter(Boolean).join(' · ') || '—'
}

function formatTimeCell(row: BookingRow): string {
  if (!row.timeFrom) return '—'
  return row.timeTo ? `${row.timeFrom} – ${row.timeTo}` : row.timeFrom
}

function formatAmount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

// createdAt — момент вставки строки в зеркало bookings (≈ время создания брони:
// вставка идёт только после успешного append в Sheets). Показываем подсказкой на
// порядковом номере, чтобы не занимать отдельную колонку.
function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Заливка строки по статусу готовности живёт в lib/readiness.ts (общая с бейджем
// карточки клиента) — перекрас статуса правится в одном месте. hover намеренно
// отключён: базовый цвет помечен важным (`!`) и выигрывает над вшитым в TableRow
// `hover:bg-muted/50`; некрашеным строкам гасим тот же hover общей строкой.
</script>

<template>
  <!-- Mobile: normal page flow (few rows fit — let the whole page scroll).
       md+: fixed-height flex column so only the rows scroll internally. -->
  <div
    class="min-h-svh bg-background text-foreground sm:p-8 md:flex md:h-svh md:flex-col"
    :class="compact ? 'p-2' : 'p-4'"
  >
    <div class="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <header class="mb-6 shrink-0 flex flex-wrap items-start justify-between gap-4">
        <h1 class="text-2xl font-semibold">Записи</h1>
      </header>

      <!-- Filters. Один набор контролов, две раскладки: строка над таблицей в
           полном режиме и шторка снизу в компактном. -->
      <DefineFilters>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Месяц</span>
          <Select v-model="monthValue">
            <SelectTrigger size="sm" class="w-44">
              <SelectValue placeholder="Свой период" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">Все месяцы</SelectItem>
              <SelectItem v-for="mo in monthOptions" :key="mo.value" :value="mo.value">
                {{ mo.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">С даты</span>
          <Popover v-model:open="dateFromOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" size="sm" class="justify-start gap-2 font-normal">
                <CalendarIcon class="size-4" />
                <span :class="{ 'text-muted-foreground': !dateFromCal }">
                  {{ dateFromCal ? calToDdmmyyyy(dateFromCal) : 'Любая' }}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                locale="ru-RU"
                :model-value="dateFromCal"
                @update:model-value="onDateFromSelect"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">По дату</span>
          <Popover v-model:open="dateToOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" size="sm" class="justify-start gap-2 font-normal">
                <CalendarIcon class="size-4" />
                <span :class="{ 'text-muted-foreground': !dateToCal }">
                  {{ dateToCal ? calToDdmmyyyy(dateToCal) : 'Любая' }}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                locale="ru-RU"
                :model-value="dateToCal"
                @update:model-value="onDateToSelect"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Мастер</span>
          <Select v-model="masterFilter">
            <SelectTrigger size="sm" class="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">Все</SelectItem>
              <SelectItem v-for="m in masterOptions" :key="m" :value="m">
                {{ m }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Готовность</span>
          <Select v-model="readinessFilter">
            <SelectTrigger size="sm" class="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">Все</SelectItem>
              <SelectItem v-for="r in READINESS" :key="r" :value="r">
                {{ r }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </DefineFilters>

      <DefineSearch>
        <div class="relative">
          <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="searchInput"
            type="search"
            class="h-9 pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
            placeholder="Имя, телефон или машина"
          />
          <button
            v-if="searchInput"
            type="button"
            aria-label="Очистить поиск"
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
            @click="searchInput = ''"
          >
            <X class="size-4" />
          </button>
        </div>
      </DefineSearch>

      <div v-if="compact" class="mb-3 shrink-0 flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <div class="flex-1">
            <ReuseSearch />
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-9 gap-1"
            @click="filtersSheetOpen = true"
          >
            <SlidersHorizontal class="size-4" />
            Фильтры
            <span
              v-if="activeFilterCount"
              class="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums"
            >
              {{ activeFilterCount }}
            </span>
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            class="size-9"
            aria-label="Экспорт"
            :disabled="exporting || loading || total === 0"
            @click="onExport"
          >
            <Download class="size-4" />
          </Button>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <Checkbox
              id="bookings-compact"
              :model-value="compact"
              @update:model-value="(v) => (compact = v === true)"
            />
            <Label for="bookings-compact" class="text-xs font-normal text-muted-foreground">
              Компактный режим
            </Label>
          </div>
          <Button
            v-if="hasActiveFilters"
            variant="ghost"
            size="sm"
            class="h-7 gap-1 text-xs text-muted-foreground"
            @click="resetFilters"
          >
            <X class="size-3.5" /> Сбросить
          </Button>
        </div>
      </div>

      <div v-else class="mb-4 shrink-0 flex flex-wrap items-end gap-3">
        <ReuseFilters />

        <div class="flex flex-1 flex-col gap-1">
          <span class="text-xs text-muted-foreground">Поиск</span>
          <ReuseSearch />
        </div>

        <div class="flex h-8 items-center gap-2">
          <Checkbox
            id="bookings-compact-wide"
            :model-value="compact"
            @update:model-value="(v) => (compact = v === true)"
          />
          <Label for="bookings-compact-wide" class="font-normal text-muted-foreground">
            Компактный режим
          </Label>
        </div>

        <Button
          v-if="hasActiveFilters"
          variant="ghost"
          size="sm"
          class="gap-1 text-muted-foreground"
          @click="resetFilters"
        >
          <X class="size-4" /> Сбросить
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="gap-1"
          :disabled="exporting || loading || total === 0"
          @click="onExport"
        >
          <Download class="size-4" /> {{ exporting ? 'Экспорт…' : 'Экспорт' }}
        </Button>
      </div>

      <Sheet v-model:open="filtersSheetOpen">
        <SheetContent side="bottom" class="max-h-svh gap-4 overflow-y-auto rounded-t-lg p-4">
          <SheetHeader class="p-0">
            <SheetTitle>Фильтры</SheetTitle>
          </SheetHeader>
          <div class="flex flex-wrap gap-3">
            <ReuseFilters />
          </div>
          <Button
            v-if="hasActiveFilters"
            variant="outline"
            size="sm"
            class="gap-1 self-start"
            @click="resetFilters"
          >
            <X class="size-4" /> Сбросить фильтры
          </Button>
        </SheetContent>
      </Sheet>

      <Alert v-if="error" variant="destructive" class="shrink-0">
        <AlertTitle>Не удалось загрузить записи</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <Table
        v-else
        container-class="rounded-md border border-border md:min-h-0 md:flex-1"
        :class="[{ 'table-fixed': !isEmpty, 'h-full': isEmpty, 'text-xs': compact }]"
      >
        <!-- Fixed column widths so they don't jump between pages (table-fixed
             sizes columns from these, not from each page's content). Dropped when
             empty: the fixed widths force the table far wider than the viewport,
             which would leave the placeholder behind a horizontal scrollbar with
             nothing to scroll to. -->
        <colgroup v-if="!isEmpty && compact">
          <col />
        </colgroup>
        <colgroup v-else-if="!isEmpty">
          <col class="w-14" />
          <col class="w-40" />
          <col class="w-24" />
          <col class="w-36" />
          <col class="w-40" />
          <col class="w-40" />
          <col class="w-64" />
          <col v-if="isAdmin" class="w-28" />
          <col class="w-44" />
          <col class="w-40" />
          <col class="w-40" />
          <col class="w-48" />
          <col v-if="isAdmin" class="w-24" />
        </colgroup>
        <TableHeader v-if="!isEmpty && !compact" class="sticky top-0 z-10 bg-muted">
            <TableRow>
              <TableHead class="px-4 text-right">#</TableHead>
              <TableHead class="px-4">Дата</TableHead>
              <TableHead class="px-4">Время</TableHead>
              <TableHead class="px-4">Имя</TableHead>
              <TableHead class="px-4">Телефон</TableHead>
              <TableHead class="px-4">Машина</TableHead>
              <TableHead class="px-4">Услуга</TableHead>
              <TableHead v-if="isAdmin" class="px-4 text-right whitespace-nowrap">
                Сумма ₽
              </TableHead>
              <TableHead class="px-4">Готовность</TableHead>
              <TableHead class="px-4">Мастер</TableHead>
              <TableHead class="px-4">Ответственный</TableHead>
              <TableHead class="px-4">Примечание</TableHead>
              <TableHead v-if="isAdmin" class="px-4 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="showSkeleton">
              <TableRow v-for="i in 8" :key="i">
                <TableCell v-for="c in columnCount" :key="c" class="px-4">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>
            <TableEmpty
              v-else-if="isEmpty"
              :colspan="columnCount"
              class="whitespace-normal"
            >
              <Empty class="gap-4 p-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <component :is="hasActiveFilters ? SearchX : Inbox" />
                  </EmptyMedia>
                  <EmptyTitle>
                    {{ hasActiveFilters ? 'Ничего не найдено' : 'Пока нет записей' }}
                  </EmptyTitle>
                  <EmptyDescription>
                    {{
                      hasActiveFilters
                        ? 'Попробуйте изменить условия или сбросить фильтры'
                        : 'Новые записи появятся здесь автоматически'
                    }}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent v-if="hasActiveFilters">
                  <Button variant="outline" size="sm" class="gap-1" @click="resetFilters">
                    <X class="size-4" /> Сбросить фильтры
                  </Button>
                </EmptyContent>
              </Empty>
            </TableEmpty>
            <template v-else-if="compact">
              <!-- Две строки на запись: дата, время и имя сверху, машина и услуга
                   одной усечённой строкой снизу. Остальные восемь полей — в
                   диалоге по тапу; готовность читается заливкой строки. -->
              <TableRow
                v-for="row in items"
                :key="row.id"
                tabindex="0"
                :class="[readinessRowClass(row.readiness), 'cursor-pointer']"
                :title="`Добавлена: ${formatCreatedAt(row.createdAt)}`"
                @click="openDetails(row)"
                @keydown.enter="openDetails(row)"
              >
                <TableCell class="px-3 py-2 whitespace-normal">
                  <!-- Дата, сумма и статус занимают свою ширину, машина и услуга
                       забирают весь остаток: фиксированная колонка справа
                       оставляла пустоту при коротком статусе. -->
                  <div class="flex items-baseline gap-2">
                    <span class="shrink-0 tabular-nums text-muted-foreground">
                      {{ formatDateCompact(row) }}
                      {{ formatTimeCompact(row) }}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">
                      {{ row.car || '—' }}
                    </span>
                    <span
                      v-if="isAdmin"
                      class="shrink-0 text-sm font-medium tabular-nums"
                      :title="row.amountFormula ?? ''"
                    >
                      <template v-if="row.amount != null">{{ formatAmount(row.amount) }} ₽</template>
                      <template v-else>—</template>
                    </span>
                  </div>
                  <div class="mt-0.5 flex items-baseline gap-2">
                    <span class="min-w-0 flex-1 truncate text-muted-foreground">
                      {{ formatSummaryLine(row) }}
                    </span>
                    <div class="shrink-0">
                      <ReadinessPicker
                        variant="plain"
                        :readiness="readinessOverride[row.id] ?? row.readiness"
                        :readonly="!isAdmin"
                        :disabled="savingReadiness[row.id]"
                        @update="(v) => onReadinessChange(row, v)"
                      />
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            </template>
            <TableRow
              v-else
              v-for="(row, index) in items"
              :key="row.id"
              :class="readinessRowClass(row.readiness)"
            >
              <!-- Сквозной порядковый номер на убывание: верхняя строка = total,
                   консистентно между страницами (учитывает offset). -->
              <TableCell
                class="px-4 align-top text-right tabular-nums text-muted-foreground"
                :title="`Добавлена: ${formatCreatedAt(row.createdAt)}`"
              >
                {{ total - offset - index }}
              </TableCell>
              <TableCell class="px-4 align-top tabular-nums whitespace-normal">
                {{ formatDateCell(row) }}
              </TableCell>
              <TableCell class="px-4 align-top tabular-nums">
                {{ formatTimeCell(row) }}
              </TableCell>
              <TableCell class="px-4 align-top whitespace-normal">{{ row.name || '—' }}</TableCell>
              <TableCell class="px-4 align-top tabular-nums">
                {{ row.phone ? formatPhone(row.phone) : '—' }}
              </TableCell>
              <TableCell class="px-4 align-top whitespace-normal">{{ row.car || '—' }}</TableCell>
              <TableCell class="px-4 align-top">
                <!-- `service` is newline-separated (one line per pricelist
                     section); render it as a vertical list to keep the column
                     narrow instead of one wide run of text. -->
                <span
                  class="block max-w-56 whitespace-pre-line leading-snug"
                  :title="row.service"
                >
                  {{ row.service || '—' }}
                </span>
              </TableCell>
              <TableCell
                v-if="isAdmin"
                class="px-4 align-top text-right whitespace-nowrap tabular-nums"
              >
                <!-- Пунктирное подчёркивание сигналит, что у суммы есть формула,
                     показываемая тултипом при наведении. -->
                <span
                  :class="
                    row.amountFormula
                      ? 'underline decoration-dotted decoration-muted-foreground/60 underline-offset-4'
                      : ''
                  "
                  :title="row.amountFormula ?? ''"
                >
                  {{ row.amount != null ? formatAmount(row.amount) : '—' }}
                </span>
              </TableCell>
              <TableCell v-if="isAdmin" class="px-4 align-top">
                <Select
                  :model-value="readinessSelectValue(row)"
                  :disabled="savingReadiness[row.id]"
                  @update:model-value="(v) => onReadinessChange(row, String(v))"
                >
                  <SelectTrigger size="sm" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="READINESS_NONE">—</SelectItem>
                    <SelectItem v-for="r in READINESS" :key="r" :value="r">{{ r }}</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell v-else class="px-4 align-top">
                {{ row.readiness || '—' }}
              </TableCell>
              <TableCell class="px-4 align-top whitespace-normal">{{ row.master.length ? row.master.join(', ') : '—' }}</TableCell>
              <TableCell class="px-4 align-top whitespace-normal">
                {{ row.responsible || '—' }}
              </TableCell>
              <TableCell class="px-4 align-top whitespace-normal text-muted-foreground">
                {{ row.note || '—' }}
              </TableCell>
              <TableCell v-if="isAdmin" class="px-4 align-top text-right">
                <div class="inline-flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`Редактировать запись ${row.name || row.phone}`"
                    @click="openEdit(row)"
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`Удалить запись ${row.name || row.phone}`"
                    @click="askDelete(row)"
                  >
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
      </Table>

      <TablePagination
        v-if="!error"
        v-model:page="page"
        :total="total"
        :items-per-page="LIMIT"
        :disabled="loading"
      />
    </div>

    <BookingDetailsDialog
      v-model:open="detailsOpen"
      :booking="detailsBooking"
      :can-edit="isAdmin"
      :readiness-saving="detailsId ? savingReadiness[detailsId] : false"
      @edit="onDetailsEdit"
      @delete="onDetailsDelete"
      @readiness="(v) => detailsBooking && onReadinessChange(detailsBooking, v)"
    />

    <BookingEditDialog
      v-model:open="editDialogOpen"
      :booking="editTarget"
      @saved="onEditSaved"
    />

    <AlertDialog :open="deleteDialogOpen" @update:open="onDeleteDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              Запись «{{ deleteTarget.name || deleteTarget.phone }}» на
              {{ formatDateCell(deleteTarget) }} будет удалена. Действие нельзя отменить
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Отмена</AlertDialogCancel>
          <!-- Plain Button (not AlertDialogAction) so the dialog stays open until
               the request resolves. Deliberately NOT disabled: a disabled, focused
               button makes reka-ui's focus scope lag the close by ~1s — a
               re-entrancy guard in confirmDelete prevents double submits instead. -->
          <Button @click="confirmDelete">
            {{ deleting ? 'Удаление…' : 'Удалить' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
