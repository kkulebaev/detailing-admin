<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ChevronRight, ClockPlus, Coins, Inbox, Pencil } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useMediaQuery } from '@vueuse/core'
import {
  minutesToHours,
  salaryEntryDate,
  type Payout,
  type SalaryEntry,
  type SalaryRow,
  type WorkHours,
} from '@detailing-admin/shared'
import { deletePayout, deleteWorkHours } from '@/lib/salaries-api'
import {
  useSalariesQuery,
  useInvalidateSalaries,
  useInvalidateSalaryEntries,
} from '@/lib/queries'
import { buildMonthOptions, currentMonthKey, formatMonthAccusative } from '@/lib/month-options'
import { formatAmount, formatSigned } from '@/lib/money'
import MasterEntries from './MasterEntries.vue'
import PayoutFormDialog from './PayoutFormDialog.vue'
import RateFormDialog from './RateFormDialog.vue'
import WorkHoursFormDialog from './WorkHoursFormDialog.vue'
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
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

const COLUMN_COUNT = 7

// Семь колонок таблицы не помещаются в телефон, поэтому ниже 640px та же строка
// мастера собирается в карточку. Решает только ширина экрана — данные и
// обработчики у обеих раскладок общие.
const isWideScreen = useMediaQuery('(min-width: 640px)')

const monthOptions = buildMonthOptions()
const month = ref(currentMonthKey())

const invalidateSalaries = useInvalidateSalaries()
const invalidateSalaryEntries = useInvalidateSalaryEntries()

const { data: queryData, error: queryError, asyncStatus } = useSalariesQuery(month)

const rows = computed<SalaryRow[]>(() => {
  const r = queryData.value
  return r?.ok ? r.rows : []
})

// The month the rows on screen actually describe; lags `month` while
// placeholderData keeps the previous month visible.
const dataMonth = computed(() => (queryData.value?.ok ? queryData.value.month : ''))

// The column the page exists for, summed into the header: the same number the
// «Итого» column prints, but without scrolling the table to read it.
const monthTotal = computed(() => rows.value.reduce((acc, r) => acc + r.total, 0))

// Skeleton only on the very first load — month switches keep the previous rows
// visible (placeholderData in useSalariesQuery), so `loading` is false then.
const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

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

const isEmpty = computed(
  () =>
    asyncStatus.value !== 'loading' &&
    !showSkeleton.value &&
    !loading.value &&
    rows.value.length === 0,
)

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке зарплат'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить список зарплат'
})

// ── Formatting ────────────────────────────────────────────────────────────────
// Minutes → a compact hours label ("7,5", "8"), ru-RU decimal comma.
function formatHours(minutes: number): string {
  return minutesToHours(minutes).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// "2026-01-22" → "22 января 2026 г." Local-midnight Date avoids a UTC day shift.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ── Rate dialog ────────────────────────────────────────────────────────────────
const rateDialogOpen = ref(false)
const rateTarget = ref<{ masterId: number; masterName: string; currentRate: number | null }>({
  masterId: 0,
  masterName: '',
  currentRate: null,
})

function openRate(row: SalaryRow) {
  rateTarget.value = {
    masterId: row.masterId,
    masterName: row.masterName,
    currentRate: row.hourlyRate,
  }
  rateDialogOpen.value = true
}

async function onRateSaved() {
  await invalidateSalaries()
}

// ── Expandable per-master detail ───────────────────────────────────────────────
// Each master row expands to reveal its hours and payouts as sub-rows inline (no
// dialog). Several can stay open at once; MasterEntries owns the per-master
// query. Totals in the master row stay live off `rows`.
const expanded = ref<Set<number>>(new Set())

// Auto-open every master that has something this month, once per month. Keyed
// off the response's own `month` (not the selected ref) so the previous month's
// placeholder data doesn't seed early. Manual collapse/expand persists until the
// month changes. A master whose payouts cancelled out (+2000 and −2000) is not
// auto-opened — payoutsTotal 0 means "nothing this month" by design.
let seededMonth: string | null = null
watch(
  queryData,
  (data) => {
    if (data?.ok && data.month !== seededMonth) {
      seededMonth = data.month
      expanded.value = new Set(
        data.rows
          .filter((r) => r.totalMinutes > 0 || r.payoutsTotal !== 0)
          .map((r) => r.masterId),
      )
    }
  },
  { immediate: true },
)

// A row that was collapsed hides the record that was just added: the master
// row would update its totals while the entry itself stayed out of sight.
function ensureExpanded(masterId: number) {
  if (expanded.value.has(masterId)) return
  const next = new Set(expanded.value)
  next.add(masterId)
  expanded.value = next
}

function toggleExpand(masterId: number) {
  const next = new Set(expanded.value)
  if (next.has(masterId)) next.delete(masterId)
  else next.add(masterId)
  expanded.value = next
}

// ── Work-hours create/edit dialog ──────────────────────────────────────────────
const hoursDialogOpen = ref(false)
const hoursEditing = ref<WorkHours | null>(null)
const hoursMaster = ref<{ id: number | null; name: string }>({ id: null, name: '' })

// Toolbar "add hours" can only target masters that already have a rate.
const eligibleMasters = computed(() =>
  rows.value
    .filter((r) => r.hourlyRate != null)
    .map((r) => ({ id: r.masterId, name: r.masterName })),
)

// Payouts need no rate, so the toolbar payout dialog offers every row.
const allMasters = computed(() =>
  rows.value.map((r) => ({ id: r.masterId, name: r.masterName })),
)

function openAddHours(row: SalaryRow) {
  hoursEditing.value = null
  hoursMaster.value = { id: row.masterId, name: row.masterName }
  hoursDialogOpen.value = true
}

function openAddHoursGeneral() {
  hoursEditing.value = null
  hoursMaster.value = { id: null, name: '' }
  hoursDialogOpen.value = true
}

async function onHoursSaved(masterId: number) {
  ensureExpanded(masterId)
  await Promise.all([invalidateSalaries(), invalidateSalaryEntries()])
}

// ── Payout create/edit dialog ──────────────────────────────────────────────────
const payoutDialogOpen = ref(false)
const payoutEditing = ref<Payout | null>(null)
const payoutMaster = ref<{ id: number | null; name: string }>({ id: null, name: '' })

function openAddPayout(row: SalaryRow) {
  payoutEditing.value = null
  payoutMaster.value = { id: row.masterId, name: row.masterName }
  payoutDialogOpen.value = true
}

function openAddPayoutGeneral() {
  payoutEditing.value = null
  payoutMaster.value = { id: null, name: '' }
  payoutDialogOpen.value = true
}

// Both totals move when a payout changes, so both keys are invalidated.
async function onPayoutSaved(masterId: number) {
  ensureExpanded(masterId)
  await Promise.all([invalidateSalaries(), invalidateSalaryEntries()])
}

// ── Editing from the detail feed ───────────────────────────────────────────────
// The feed is one list of both kinds; the page routes each entry to its dialog.
function openEditEntry(entry: SalaryEntry) {
  const master = rows.value.find((r) => r.masterId === entry.masterId)
  if (entry.kind === 'hours') {
    hoursEditing.value = entry
    hoursMaster.value = { id: entry.masterId, name: master?.masterName ?? '' }
    hoursDialogOpen.value = true
    return
  }
  payoutEditing.value = entry
  payoutMaster.value = { id: entry.masterId, name: master?.masterName ?? '' }
  payoutDialogOpen.value = true
}

// ── Delete an entry ────────────────────────────────────────────────────────────
const deleteDialogOpen = ref(false)
const deleteTarget = ref<SalaryEntry | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function askDelete(entry: SalaryEntry) {
  deleteTarget.value = entry
  deleteError.value = null
  deleteDialogOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  const isPayout = target.kind === 'payout'
  const noun = isPayout ? 'выплату' : 'запись'
  deleteError.value = null
  deleting.value = true
  try {
    const result = isPayout ? await deletePayout(target.id) : await deleteWorkHours(target.id)
    if (result.ok || result.error === 'not_found') {
      toast.success(
        `${isPayout ? 'Выплата' : 'Запись'} ${result.ok ? 'удалена' : 'уже удалена'}`,
      )
      deleteDialogOpen.value = false
      await Promise.all([invalidateSalaries(), invalidateSalaryEntries()])
      return
    }
    deleteError.value =
      result.error === 'unavailable' ? result.message : `Не удалось удалить ${noun}`
  } catch {
    deleteError.value = `Не удалось удалить ${noun}`
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-2 sm:p-8 md:flex md:h-svh md:flex-col">
    <div class="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <header class="mb-6 shrink-0 flex flex-wrap items-start justify-between gap-4">
        <h1 class="text-2xl font-semibold">Зарплаты</h1>

        <!-- Named by `dataMonth`, not by `month`: while the previous month is
             still on screen the caption says which month this figure is. -->
        <div v-if="!error" class="flex flex-col items-end gap-1">
          <span class="text-xs text-muted-foreground">
            Всего к выплате<template v-if="dataMonth">
              за {{ formatMonthAccusative(dataMonth) }}</template
            >
          </span>
          <Skeleton v-if="showSkeleton" class="h-8 w-40" />
          <span
            v-else
            class="text-2xl font-semibold tabular-nums"
            :class="{ 'text-destructive': monthTotal < 0 }"
          >
            {{ formatAmount(monthTotal) }} ₽
          </span>
        </div>
      </header>

      <div class="mb-4 shrink-0 flex flex-wrap items-end gap-3">
        <!-- На узком экране селектор занимает строку целиком, а кнопки делят
             следующую пополам: фиксированная w-44 оставляла полстроки пустой. -->
        <div class="flex w-full flex-col gap-1 sm:w-auto">
          <span class="text-xs text-muted-foreground">Месяц</span>
          <Select v-model="month">
            <SelectTrigger size="sm" class="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="mo in monthOptions" :key="mo.value" :value="mo.value">
                {{ mo.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="ml-auto flex w-full items-end gap-2 sm:w-auto">
          <Button
            v-if="eligibleMasters.length > 0"
            variant="outline"
            size="sm"
            class="flex-1 sm:flex-none"
            @click="openAddHoursGeneral"
          >
            <ClockPlus class="size-4" /> Добавить часы
          </Button>
          <!-- A payout needs no rate, so this one only needs a row to exist. -->
          <Button
            v-if="rows.length > 0"
            variant="outline"
            size="sm"
            class="flex-1 sm:flex-none"
            @click="openAddPayoutGeneral"
          >
            <Coins class="size-4" /> Добавить выплату
          </Button>
        </div>
      </div>

      <Alert v-if="error" variant="destructive" class="shrink-0">
        <AlertTitle>Не удалось загрузить зарплаты</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <Table
        v-else-if="isWideScreen"
        container-class="rounded-md border border-border md:min-h-0 md:flex-1"
        :class="[{ 'table-fixed min-w-284': !isEmpty, 'h-full': isEmpty }]"
      >
        <colgroup v-if="!isEmpty">
          <col class="w-56" />
          <col class="w-40" />
          <col class="w-24" />
          <col class="w-36" />
          <col class="w-32" />
          <col class="w-36" />
          <col class="w-60" />
        </colgroup>
        <TableHeader class="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead class="px-4">Мастер</TableHead>
            <TableHead class="px-4 text-right whitespace-nowrap">Ставка ₽/ч</TableHead>
            <TableHead class="px-4 text-right">Часы</TableHead>
            <TableHead class="px-4 text-right whitespace-nowrap">За часы ₽</TableHead>
            <TableHead class="px-4 text-right whitespace-nowrap">Разовые ₽</TableHead>
            <TableHead class="px-4 text-right whitespace-nowrap">Итого ₽</TableHead>
            <TableHead class="px-4 text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="showSkeleton">
            <TableRow v-for="i in 6" :key="i">
              <TableCell v-for="c in COLUMN_COUNT" :key="c" class="px-4">
                <Skeleton class="h-4 w-full" />
              </TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="isEmpty" :colspan="COLUMN_COUNT" class="whitespace-normal">
            <Empty class="gap-4 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>Некому начислять зарплату</EmptyTitle>
                <EmptyDescription>
                  Включите «Начисляется зарплата» в карточке мастера — и он появится здесь
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TableEmpty>
          <template v-else>
            <template v-for="row in rows" :key="row.masterId">
              <TableRow class="border-t-2 border-t-border">
                <TableCell class="px-4 align-middle whitespace-normal font-medium">
                  {{ row.masterName }}
                </TableCell>
                <TableCell class="px-4 align-middle text-right tabular-nums">
                  <div class="inline-flex items-center justify-end gap-1">
                    <span :class="{ 'text-muted-foreground': row.hourlyRate == null }">
                      {{ row.hourlyRate != null ? formatAmount(row.hourlyRate) : 'не задана' }}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="`Изменить ставку — ${row.masterName}`"
                      @click="openRate(row)"
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell class="px-4 align-middle text-right tabular-nums">
                  {{ formatHours(row.totalMinutes) }}
                </TableCell>
                <TableCell class="px-4 align-middle text-right tabular-nums">
                  {{ formatAmount(row.hoursSalary) }}
                </TableCell>
                <TableCell
                  class="px-4 align-middle text-right tabular-nums"
                  :class="{
                    'text-muted-foreground': row.payoutsTotal === 0,
                    'text-destructive': row.payoutsTotal < 0,
                  }"
                >
                  {{ row.payoutsTotal === 0 ? '—' : formatSigned(row.payoutsTotal) }}
                </TableCell>
                <TableCell
                  class="px-4 align-middle text-right font-medium tabular-nums"
                  :class="{ 'text-destructive': row.total < 0 }"
                >
                  {{ formatAmount(row.total) }}
                </TableCell>
                <TableCell class="px-4 align-middle text-right">
                  <div class="inline-flex gap-1">
                    <!-- No rate yet: hours can't be logged without one, so the
                         row offers setting it instead of a dead disabled "+".
                         A payout needs no rate, so its button is always there. -->
                    <Button
                      v-if="row.hourlyRate == null"
                      variant="outline"
                      size="sm"
                      class="h-7"
                      :aria-label="`Задать ставку — ${row.masterName}`"
                      @click="openRate(row)"
                    >
                      Задать ставку
                    </Button>
                    <Button
                      v-else
                      variant="ghost"
                      size="icon-sm"
                      title="Добавить часы"
                      :aria-label="`Добавить часы — ${row.masterName}`"
                      @click="openAddHours(row)"
                    >
                      <ClockPlus class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Добавить выплату"
                      :aria-label="`Добавить выплату — ${row.masterName}`"
                      @click="openAddPayout(row)"
                    >
                      <Coins class="size-3.5" />
                    </Button>
                    <!-- Outside the rate branch on purpose: a master with no rate
                         can still have payouts, and the row must be collapsible. -->
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :title="expanded.has(row.masterId) ? 'Скрыть часы и выплаты' : 'Показать часы и выплаты'"
                      :aria-label="`${expanded.has(row.masterId) ? 'Скрыть' : 'Показать'} часы и выплаты — ${row.masterName}`"
                      @click="toggleExpand(row.masterId)"
                    >
                      <ChevronRight
                        class="size-4 transition-transform"
                        :class="{ 'rotate-90': expanded.has(row.masterId) }"
                      />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <MasterEntries
                v-if="expanded.has(row.masterId)"
                :master-id="row.masterId"
                :month="month"
                :column-count="COLUMN_COUNT"
                @edit="openEditEntry"
                @delete="askDelete"
              />
            </template>
          </template>
        </TableBody>
      </Table>

      <!-- Компактная раскладка: одна карточка на мастера. Имя и «Итого» —
           первая строка, остальные колонки уходят в подпись под именем, а
           колонка действий превращается в иконки справа от суммы. -->
      <div v-else class="overflow-hidden rounded-md border border-border">
        <template v-if="showSkeleton">
          <div
            v-for="i in 6"
            :key="i"
            class="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
          >
            <Skeleton class="h-4 flex-1" />
            <Skeleton class="h-4 w-16" />
          </div>
        </template>

        <Empty v-else-if="isEmpty" class="gap-4 p-6 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Некому начислять зарплату</EmptyTitle>
            <EmptyDescription>
              Включите «Начисляется зарплата» в карточке мастера — и он появится здесь
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <template v-else>
          <div
            v-for="row in rows"
            :key="row.masterId"
            class="border-b border-border last:border-b-0"
          >
            <div class="flex items-start gap-3 px-3 py-3">
              <div class="min-w-0 flex-1">
                <div class="font-medium">{{ row.masterName }}</div>
                <div
                  class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
                >
                  <!-- Карандаш и есть кнопка «задать ставку»: отдельная текстовая
                       кнопка из таблицы в карточку уже не влезает. -->
                  <span class="inline-flex items-center gap-1">
                    Ставка
                    <span
                      class="tabular-nums"
                      :class="row.hourlyRate != null ? 'text-foreground' : ''"
                    >
                      {{
                        row.hourlyRate != null
                          ? `${formatAmount(row.hourlyRate)} ₽/ч`
                          : 'не задана'
                      }}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="size-6"
                      :aria-label="`Изменить ставку — ${row.masterName}`"
                      @click="openRate(row)"
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                  </span>
                  <!-- Нули и прочерки в карточке — шум: показываем только то,
                       из чего действительно сложилось «Итого». -->
                  <span v-if="row.totalMinutes > 0" class="tabular-nums">
                    Часы <span class="text-foreground">{{ formatHours(row.totalMinutes) }}</span>
                  </span>
                  <span v-if="row.hoursSalary !== 0" class="tabular-nums">
                    За часы
                    <span class="text-foreground">{{ formatAmount(row.hoursSalary) }} ₽</span>
                  </span>
                  <span v-if="row.payoutsTotal !== 0" class="tabular-nums">
                    Разовые
                    <span
                      :class="row.payoutsTotal < 0 ? 'text-destructive' : 'text-foreground'"
                    >
                      {{ formatSigned(row.payoutsTotal) }} ₽
                    </span>
                  </span>
                </div>
              </div>

              <div class="flex shrink-0 flex-col items-end gap-1">
                <span
                  class="font-semibold tabular-nums"
                  :class="{ 'text-destructive': row.total < 0 }"
                >
                  {{ formatAmount(row.total) }} ₽
                </span>
                <div class="inline-flex">
                  <Button
                    v-if="row.hourlyRate != null"
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`Добавить часы — ${row.masterName}`"
                    @click="openAddHours(row)"
                  >
                    <ClockPlus class="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`Добавить выплату — ${row.masterName}`"
                    @click="openAddPayout(row)"
                  >
                    <Coins class="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`${expanded.has(row.masterId) ? 'Скрыть' : 'Показать'} часы и выплаты — ${row.masterName}`"
                    @click="toggleExpand(row.masterId)"
                  >
                    <ChevronRight
                      class="size-4 transition-transform"
                      :class="{ 'rotate-90': expanded.has(row.masterId) }"
                    />
                  </Button>
                </div>
              </div>
            </div>

            <MasterEntries
              v-if="expanded.has(row.masterId)"
              layout="list"
              :master-id="row.masterId"
              :month="month"
              :column-count="COLUMN_COUNT"
              @edit="openEditEntry"
              @delete="askDelete"
            />
          </div>
        </template>
      </div>
    </div>

    <RateFormDialog
      v-model:open="rateDialogOpen"
      :master-id="rateTarget.masterId"
      :master-name="rateTarget.masterName"
      :current-rate="rateTarget.currentRate"
      @saved="onRateSaved"
    />

    <WorkHoursFormDialog
      v-model:open="hoursDialogOpen"
      :editing="hoursEditing"
      :master-id="hoursMaster.id"
      :master-name="hoursMaster.name"
      :masters="eligibleMasters"
      @saved="onHoursSaved"
    />

    <PayoutFormDialog
      v-model:open="payoutDialogOpen"
      :editing="payoutEditing"
      :master-id="payoutMaster.id"
      :master-name="payoutMaster.name"
      :masters="allMasters"
      @saved="onPayoutSaved"
    />

    <AlertDialog :open="deleteDialogOpen" @update:open="(v) => (deleteDialogOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ deleteTarget?.kind === 'payout' ? 'Удалить выплату?' : 'Удалить запись?' }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              {{ deleteTarget.kind === 'payout' ? 'Выплата' : 'Запись' }} за
              {{ formatDate(salaryEntryDate(deleteTarget)) }} будет удалена. Итоги
              пересчитаются. Действие нельзя отменить
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Отмена</AlertDialogCancel>
          <Button @click="confirmDelete">
            {{ deleting ? 'Удаление…' : 'Удалить' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
