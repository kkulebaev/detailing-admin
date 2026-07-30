<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Inbox, Pencil, Search, SearchX, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { DateValue } from 'reka-ui'
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'
import { READINESS, type BookingRow } from '@detailing-admin/shared'
import { deleteBooking, updateBookingReadiness, type GetApiBookingsParams } from '@/lib/bookings-api'
import { useBookingsQuery, useInvalidateBookings, useMastersQuery } from '@/lib/queries'
import { resolveMasterOptions } from '@/lib/master-options'
import { useAuthStore } from '@/stores/auth'
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
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

const LIMIT = 50
// reka-ui Select needs a non-empty value, so «Все» rides on a sentinel that the
// params builder maps back to `undefined` (no filter).
const ALL = '__all__'

// The «Сумма» column is admin-only; the API also omits `amount` for non-admins.
const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === 'admin')
// admin: +«Сумма» +«Действия» over the employee base of 10.
const columnCount = computed(() => (isAdmin.value ? 12 : 10))

const invalidateBookings = useInvalidateBookings()

// ── Inline readiness quick-change (admin) ──────────────────────────────────
// reka-ui Select rejects '', so the «нет статуса» option rides on a sentinel.
const READINESS_NONE = '__none__'
// Optimistic per-row state: the picked value shows immediately while the PATCH
// is in flight, and reverts to the server value on failure.
const readinessOverride = ref<Record<string, string>>({})
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
const readinessFilter = ref<string>(ALL)
const searchInput = ref('')
const searchDebounced = refDebounced(searchInput, 300)
const offset = ref(0)

const { data: mastersData } = useMastersQuery()
const masterOptions = computed(() =>
  resolveMasterOptions(
    mastersData.value?.ok ? mastersData.value.masters : undefined,
    () => true,
  ),
)

function calToDdmmyyyy(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

// ── Month quick-filter ──────────────────────────────────────────────────────
// A convenience over the two date pickers: picking a month sets the range to its
// first…last day; the pickers stay the single source of truth (manually tweaking
// them shows «Свой период» in the month select).
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTH_CUSTOM = '__custom__'

// Rolling window: 1 month ahead down to 12 back, newest first.
const monthOptions = (() => {
  const anchor = today(getLocalTimeZone())
  const first = new CalendarDate(anchor.year, anchor.month, 1)
  const opts: { value: string; label: string }[] = []
  for (let i = 1; i >= -12; i--) {
    const d = first.add({ months: i })
    opts.push({
      value: `${d.year}-${String(d.month).padStart(2, '0')}`,
      label: `${MONTH_NAMES[d.month - 1]} ${d.year}`,
    })
  }
  return opts
})()

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
    offset.value = 0
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

// ── Pagination ────────────────────────────────────────────────────────────────
const canPrev = computed(() => offset.value > 0)
const canNext = computed(() => offset.value + LIMIT < total.value)
const rangeStart = computed(() => (total.value === 0 ? 0 : offset.value + 1))
const rangeEnd = computed(() => Math.min(offset.value + LIMIT, total.value))

function prevPage() {
  offset.value = Math.max(0, offset.value - LIMIT)
}

function nextPage() {
  if (canNext.value) offset.value += LIMIT
}

// ── Filter reset ──────────────────────────────────────────────────────────────
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
// DB dates arrive as ISO `YYYY-MM-DD`; the sheet-facing display is DD.MM.YYYY.
function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

function formatDateCell(row: BookingRow): string {
  const from = isoToDdmmyyyy(row.dateFrom)
  return row.dateTo ? `${from}–${isoToDdmmyyyy(row.dateTo)}` : from
}

function formatTimeCell(row: BookingRow): string {
  if (!row.timeFrom) return '—'
  return row.timeTo ? `${row.timeFrom}–${row.timeTo}` : row.timeFrom
}

function formatPhone(raw: string): string {
  const match = /^(.+?)(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(raw)
  if (!match) return raw
  const [, prefix, a, b, c, d] = match
  return `${prefix}-${a}-${b}-${c}-${d}`
}

function formatAmount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
</script>

<template>
  <!-- Mobile: normal page flow (few rows fit — let the whole page scroll).
       md+: fixed-height flex column so only the rows scroll internally. -->
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8 md:flex md:h-svh md:flex-col">
    <div class="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <header class="mb-6 shrink-0 flex flex-wrap items-start justify-between gap-4">
        <h1 class="text-2xl font-semibold">Записи</h1>
      </header>

      <!-- Filters -->
      <div class="mb-4 shrink-0 flex flex-wrap items-end gap-3">
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

        <div class="flex flex-1 flex-col gap-1">
          <span class="text-xs text-muted-foreground">Поиск</span>
          <div class="relative">
            <Search
              class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="searchInput"
              type="search"
              class="h-9 pl-9"
              placeholder="Имя, телефон или машина"
            />
          </div>
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
      </div>

      <Alert v-if="error" variant="destructive" class="shrink-0">
        <AlertTitle>Не удалось загрузить записи</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <Table
        v-else
        container-class="rounded-md border border-border md:min-h-0 md:flex-1"
        class="table-fixed"
      >
        <!-- Fixed column widths so they don't jump between pages (table-fixed
             sizes columns from these, not from each page's content). -->
        <colgroup>
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
        <TableHeader class="sticky top-0 z-10 bg-muted">
            <TableRow>
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
              v-else-if="!loading && items.length === 0"
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
            <TableRow v-else v-for="row in items" :key="row.id">
              <TableCell class="px-4 align-top tabular-nums">
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
                {{ row.amount != null ? formatAmount(row.amount) : '—' }}
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
              <TableCell class="px-4 align-top whitespace-normal">{{ row.master || '—' }}</TableCell>
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

      <!-- Pagination -->
      <div
        v-if="!error"
        class="mt-4 shrink-0 flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-sm text-muted-foreground tabular-nums">
          <template v-if="total > 0">
            {{ rangeStart }}–{{ rangeEnd }} из {{ total }}
          </template>
          <template v-else>Всего: 0</template>
        </p>
        <div class="inline-flex gap-2">
          <Button
            variant="outline"
            size="sm"
            class="gap-1"
            :disabled="!canPrev || loading"
            @click="prevPage"
          >
            <ChevronLeft class="size-4" /> Назад
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="gap-1"
            :disabled="!canNext || loading"
            @click="nextPage"
          >
            Вперед <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>

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
