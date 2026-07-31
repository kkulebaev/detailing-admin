<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ChevronRight, Inbox, Pencil, Plus } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { minutesToHours, type SalaryRow, type WorkHours } from '@detailing-admin/shared'
import { deleteWorkHours } from '@/lib/salaries-api'
import {
  useSalariesQuery,
  useInvalidateSalaries,
  useInvalidateWorkHours,
} from '@/lib/queries'
import { buildMonthOptions, currentMonthKey } from '@/lib/month-options'
import MasterHoursRows from './MasterHoursRows.vue'
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

const COLUMN_COUNT = 5

const monthOptions = buildMonthOptions()
const month = ref(currentMonthKey())

const invalidateSalaries = useInvalidateSalaries()
const invalidateWorkHours = useInvalidateWorkHours()

const { data: queryData, error: queryError, asyncStatus } = useSalariesQuery(month)

const rows = computed<SalaryRow[]>(() => {
  const r = queryData.value
  return r?.ok ? r.rows : []
})

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
  return 'Не удалось загрузить зарплаты'
})

// ── Formatting ────────────────────────────────────────────────────────────────
function formatAmount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

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

// ── Expandable per-master hours ────────────────────────────────────────────────
// Each master row expands to reveal its hours entries as sub-rows inline (no
// dialog). Several can stay open at once; MasterHoursRows owns the per-master
// query. Salary/hours totals in the master row stay live off `rows`.
const expanded = ref<Set<number>>(new Set())

// Auto-open every master that has hours, once per month. Keyed off the response's
// own `month` (not the selected ref) so the previous month's placeholder data
// doesn't seed early. Manual collapse/expand persists until the month changes.
let seededMonth: string | null = null
watch(
  queryData,
  (data) => {
    if (data?.ok && data.month !== seededMonth) {
      seededMonth = data.month
      expanded.value = new Set(
        data.rows.filter((r) => r.totalMinutes > 0).map((r) => r.masterId),
      )
    }
  },
  { immediate: true },
)

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

function openEditHours(entry: WorkHours) {
  hoursEditing.value = entry
  const master = rows.value.find((r) => r.masterId === entry.masterId)
  hoursMaster.value = { id: entry.masterId, name: master?.masterName ?? '' }
  hoursDialogOpen.value = true
}

async function onHoursSaved() {
  await Promise.all([invalidateSalaries(), invalidateWorkHours()])
}

// ── Delete a work-hours entry ────────────────────────────────────────────────────
const deleteDialogOpen = ref(false)
const deleteTarget = ref<WorkHours | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function askDelete(entry: WorkHours) {
  deleteTarget.value = entry
  deleteError.value = null
  deleteDialogOpen.value = true
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleteError.value = null
  deleting.value = true
  try {
    const result = await deleteWorkHours(target.id)
    if (result.ok || result.error === 'not_found') {
      toast.success(result.ok ? 'Запись удалена' : 'Запись уже удалена')
      deleteDialogOpen.value = false
      await Promise.all([invalidateSalaries(), invalidateWorkHours()])
      return
    }
    deleteError.value =
      result.error === 'unavailable' ? result.message : 'Не удалось удалить запись'
  } catch {
    deleteError.value = 'Не удалось удалить запись'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8 md:flex md:h-svh md:flex-col">
    <div class="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <header class="mb-6 shrink-0">
        <h1 class="text-2xl font-semibold">Зарплаты</h1>
      </header>

      <div class="mb-4 shrink-0 flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">Месяц</span>
          <Select v-model="month">
            <SelectTrigger size="sm" class="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="mo in monthOptions" :key="mo.value" :value="mo.value">
                {{ mo.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          class="ml-auto"
          :disabled="eligibleMasters.length === 0"
          :title="eligibleMasters.length === 0 ? 'Сначала задайте ставку хотя бы одному мастеру' : undefined"
          @click="openAddHoursGeneral"
        >
          <Plus class="size-4" /> Добавить часы
        </Button>
      </div>

      <Alert v-if="error" variant="destructive" class="shrink-0">
        <AlertTitle>Не удалось загрузить зарплаты</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <Table
        v-else
        container-class="rounded-md border border-border md:min-h-0 md:flex-1"
        :class="['table-fixed', { 'h-full': isEmpty }]"
      >
        <colgroup>
          <col class="w-56" />
          <col class="w-40" />
          <col class="w-32" />
          <col class="w-36" />
          <col class="w-40" />
        </colgroup>
        <TableHeader class="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead class="px-4">Мастер</TableHead>
            <TableHead class="px-4 text-right whitespace-nowrap">Текущая ставка ₽/ч</TableHead>
            <TableHead class="px-4 text-right">Часы</TableHead>
            <TableHead class="px-4 text-right whitespace-nowrap">Зарплата ₽</TableHead>
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
                <EmptyTitle>Пока нет мастеров</EmptyTitle>
                <EmptyDescription>
                  Добавьте мастеров, чтобы задавать ставки и учитывать часы
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
              {{ formatAmount(row.salary) }}
            </TableCell>
            <TableCell class="px-4 align-middle text-right">
              <div class="inline-flex gap-1">
                <!-- No rate yet: hours can't be logged without one, so the row's
                     only action is to set it — an explicit CTA instead of a dead
                     disabled "+". Once a rate exists, the add/detail buttons show. -->
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
                <template v-else>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Добавить часы"
                    :aria-label="`Добавить часы — ${row.masterName}`"
                    @click="openAddHours(row)"
                  >
                    <Plus class="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :title="expanded.has(row.masterId) ? 'Скрыть часы' : 'Показать часы'"
                    :aria-label="`${expanded.has(row.masterId) ? 'Скрыть' : 'Показать'} часы — ${row.masterName}`"
                    @click="toggleExpand(row.masterId)"
                  >
                    <ChevronRight
                      class="size-4 transition-transform"
                      :class="{ 'rotate-90': expanded.has(row.masterId) }"
                    />
                  </Button>
                </template>
              </div>
            </TableCell>
          </TableRow>
              <MasterHoursRows
                v-if="expanded.has(row.masterId)"
                :master-id="row.masterId"
                :month="month"
                :column-count="COLUMN_COUNT"
                @edit="openEditHours"
                @delete="askDelete"
              />
            </template>
          </template>
        </TableBody>
      </Table>
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

    <AlertDialog :open="deleteDialogOpen" @update:open="(v) => (deleteDialogOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              Запись за {{ formatDate(deleteTarget.workDate) }} будет удалена. Итоги
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
