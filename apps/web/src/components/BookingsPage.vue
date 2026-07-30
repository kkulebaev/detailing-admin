<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Inbox, Search, SearchX, X } from '@lucide/vue'
import type { DateValue } from 'reka-ui'
import { READINESS, type BookingRow } from '@detailing-admin/shared'
import type { GetApiBookingsParams } from '@/lib/bookings-api'
import { useBookingsQuery, useMastersQuery } from '@/lib/queries'
import { resolveMasterOptions } from '@/lib/master-options'
import { useAuthStore } from '@/stores/auth'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
const columnCount = computed(() => (isAdmin.value ? 11 : 10))

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

// Skeleton only on the very first load — background refetches keep rows visible.
const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

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
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div>
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1 class="text-2xl font-semibold">Записи</h1>
      </header>

      <!-- Filters -->
      <div class="mb-4 flex flex-wrap items-end gap-3">
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

      <Alert v-if="error" variant="destructive">
        <AlertTitle>Не удалось загрузить записи</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-else class="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="px-4 whitespace-nowrap">Дата</TableHead>
              <TableHead class="px-4 whitespace-nowrap">Время</TableHead>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 8" :key="i">
                <TableCell v-for="c in columnCount" :key="c" class="px-4">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>
            <TableEmpty
              v-else-if="items.length === 0"
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
              <TableCell class="px-4 whitespace-nowrap tabular-nums">
                {{ formatDateCell(row) }}
              </TableCell>
              <TableCell class="px-4 whitespace-nowrap tabular-nums">
                {{ formatTimeCell(row) }}
              </TableCell>
              <TableCell class="px-4">{{ row.name || '—' }}</TableCell>
              <TableCell class="px-4 whitespace-nowrap tabular-nums">
                {{ row.phone ? formatPhone(row.phone) : '—' }}
              </TableCell>
              <TableCell class="px-4">{{ row.car || '—' }}</TableCell>
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
                class="px-4 text-right whitespace-nowrap tabular-nums"
              >
                {{ row.amount != null ? formatAmount(row.amount) : '—' }}
              </TableCell>
              <TableCell class="px-4 whitespace-nowrap">
                {{ row.readiness || '—' }}
              </TableCell>
              <TableCell class="px-4 whitespace-nowrap">{{ row.master || '—' }}</TableCell>
              <TableCell class="px-4 whitespace-nowrap">
                {{ row.responsible || '—' }}
              </TableCell>
              <TableCell class="px-4">
                <span
                  v-if="row.note"
                  class="line-clamp-2 max-w-xs text-muted-foreground"
                  :title="row.note"
                >
                  {{ row.note }}
                </span>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <!-- Pagination -->
      <div
        v-if="!error"
        class="mt-4 flex flex-wrap items-center justify-between gap-3"
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
            Вперёд <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
