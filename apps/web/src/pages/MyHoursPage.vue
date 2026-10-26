<script setup lang="ts">
import { computed, ref } from 'vue'
import { ClockPlus, Inbox, Link2Off, Pencil, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  SELF_EDIT_WINDOW_DAYS,
  minutesToHours,
  salaryEntryDate,
  type SalaryEntry,
  type WorkHours,
} from '@detailing-admin/shared'
import { deleteMyWorkHours } from '@/lib/me-api'
import { useInvalidateMySalary, useMySalaryQuery } from '@/lib/queries'
import { buildMonthOptions, currentMonthKey, formatMonthAccusative } from '@/lib/month-options'
import { formatAmount, formatSigned } from '@/lib/money'
import WorkHoursFormDialog from '@/components/WorkHoursFormDialog.vue'
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
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

// Months ahead make no sense for hours already worked.
const monthOptions = buildMonthOptions(0)
const month = ref(currentMonthKey())

const invalidateMySalary = useInvalidateMySalary()
const { data: queryData, error: queryError, asyncStatus } = useMySalaryQuery(month)

const salary = computed(() => {
  const r = queryData.value
  return r?.ok ? r : null
})

const errorMessage = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке часов'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить часы'
})

const showSkeleton = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined && !queryError.value,
)

const selfWindow = computed(() =>
  salary.value
    ? { editableFrom: salary.value.editableFrom, editableTo: salary.value.editableTo }
    : undefined,
)

function isEditable(entry: SalaryEntry): entry is SalaryEntry & { kind: 'hours' } {
  const w = selfWindow.value
  return (
    entry.kind === 'hours' && !!w && entry.workDate >= w.editableFrom && entry.workDate <= w.editableTo
  )
}

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// Not rounded per row, same as the admin's detail view: the month total is
// rounded once, so rounded rows would not add up to «За часы».
function formatEntryAmount(minutes: number, rate: number): string {
  return ((minutes * rate) / 60).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// Built from parts (local midnight) so the day never shifts across UTC.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

// ── Add / edit ─────────────────────────────────────────────────────────────
const hoursDialogOpen = ref(false)
const editingHours = ref<WorkHours | null>(null)

function openAdd() {
  editingHours.value = null
  hoursDialogOpen.value = true
}

function openEdit(entry: SalaryEntry & { kind: 'hours' }) {
  editingHours.value = entry
  hoursDialogOpen.value = true
}

// ── Delete ─────────────────────────────────────────────────────────────────
const deleteDialogOpen = ref(false)
const deleteTarget = ref<WorkHours | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

function askDelete(entry: SalaryEntry & { kind: 'hours' }) {
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
    const result = await deleteMyWorkHours(target.id)
    if (result.ok || result.error === 'not_found') {
      toast.success(result.ok ? 'Запись удалена' : 'Запись уже удалена')
      deleteDialogOpen.value = false
      await invalidateMySalary()
      return
    }
    if (result.error === 'validation') {
      deleteError.value =
        result.reason === 'outside_window'
          ? 'Эту запись уже нельзя удалить — обратитесь к администратору'
          : 'Аккаунт не привязан к мастеру'
    } else {
      deleteError.value = result.error === 'unavailable' ? result.message : 'Не удалось удалить запись'
    }
  } catch {
    deleteError.value = 'Не удалось удалить запись'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-2 sm:p-8">
    <div class="mx-auto max-w-2xl">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold">Мои часы</h1>
        <p v-if="salary?.master" class="text-sm text-muted-foreground">{{ salary.master.name }}</p>
      </header>

      <Alert v-if="errorMessage" variant="destructive" class="mb-4">
        <AlertTitle>Ошибка</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <Empty v-else-if="salary && !salary.master" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Off />
          </EmptyMedia>
          <EmptyTitle>Аккаунт не привязан к мастеру</EmptyTitle>
          <EmptyDescription>
            Попросите администратора выбрать ваш аккаунт в карточке мастера в разделе «Мастера»
          </EmptyDescription>
        </EmptyHeader>
      </Empty>

      <template v-else>
        <div class="mb-4 flex flex-wrap items-end gap-3">
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
          <Button
            v-if="salary"
            size="sm"
            class="w-full sm:ml-auto sm:w-auto"
            :disabled="salary.hourlyRate == null"
            @click="openAdd"
          >
            <ClockPlus class="size-4" /> Добавить часы
          </Button>
        </div>

        <p v-if="salary && salary.hourlyRate == null" class="mb-4 text-sm text-muted-foreground">
          Ставка ещё не задана — внести часы можно будет после того, как администратор её укажет.
        </p>

        <section class="mb-6 grid grid-cols-2 gap-3">
          <template v-if="showSkeleton || !salary">
            <Skeleton v-for="i in 4" :key="i" class="h-20" />
          </template>
          <template v-else>
            <Card>
              <CardHeader class="p-3">
                <CardDescription>Часы</CardDescription>
                <CardTitle class="text-xl tabular-nums">{{ formatHours(salary.totalMinutes) }}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader class="p-3">
                <CardDescription>
                  За часы<template v-if="salary.hourlyRate != null">
                    · {{ formatAmount(salary.hourlyRate) }} ₽/ч</template
                  >
                </CardDescription>
                <CardTitle class="text-xl tabular-nums">{{ formatAmount(salary.hoursSalary) }} ₽</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader class="p-3">
                <CardDescription>Премии и вычеты</CardDescription>
                <CardTitle
                  class="text-xl tabular-nums"
                  :class="{ 'text-destructive': salary.payoutsTotal < 0 }"
                >
                  {{ salary.payoutsTotal === 0 ? '—' : `${formatSigned(salary.payoutsTotal)} ₽` }}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader class="p-3">
                <CardDescription>Итого за {{ formatMonthAccusative(salary.month) }}</CardDescription>
                <CardTitle
                  class="text-xl tabular-nums"
                  :class="{ 'text-destructive': salary.total < 0 }"
                >
                  {{ formatAmount(salary.total) }} ₽
                </CardTitle>
              </CardHeader>
            </Card>
          </template>
        </section>

        <section v-if="salary">
          <h2 class="mb-1 text-sm font-medium text-muted-foreground">Записи</h2>
          <p class="mb-3 text-xs text-muted-foreground">
            Добавлять и править часы можно за последние {{ SELF_EDIT_WINDOW_DAYS }} дней. Более
            ранние записи исправляет администратор.
          </p>

          <div
            v-if="salary.entries.length === 0"
            class="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground"
          >
            <Inbox class="size-4" /> Нет часов и выплат за месяц
          </div>

          <ul v-else class="divide-y rounded-md border">
            <li
              v-for="entry in [...salary.entries].reverse()"
              :key="`${entry.kind}-${entry.id}`"
              class="flex items-start gap-2 py-2 pr-2 pl-3"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm">{{ formatDate(salaryEntryDate(entry)) }}</div>
                <div class="text-xs text-muted-foreground tabular-nums">
                  <template v-if="entry.kind === 'hours'">
                    {{ formatHours(entry.minutes) }} ч × {{ formatAmount(entry.rateSnapshot) }} ₽
                  </template>
                  <template v-else>{{ entry.amount > 0 ? 'Премия' : 'Вычет' }}</template>
                </div>
                <div v-if="entry.note" class="text-xs text-muted-foreground">{{ entry.note }}</div>
              </div>

              <span
                class="shrink-0 pt-0.5 text-sm tabular-nums"
                :class="{ 'text-destructive': entry.kind === 'payout' && entry.amount < 0 }"
              >
                {{
                  entry.kind === 'hours'
                    ? formatEntryAmount(entry.minutes, entry.rateSnapshot)
                    : formatSigned(entry.amount)
                }}
                ₽
              </span>

              <div v-if="isEditable(entry)" class="inline-flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Редактировать часы за ${formatDate(entry.workDate)}`"
                  @click="openEdit(entry)"
                >
                  <Pencil class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Удалить часы за ${formatDate(entry.workDate)}`"
                  @click="askDelete(entry)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <WorkHoursFormDialog
      v-model:open="hoursDialogOpen"
      :editing="editingHours"
      :master-id="salary?.master?.id ?? null"
      :master-name="salary?.master?.name ?? ''"
      :self="selfWindow"
      @saved="invalidateMySalary"
    />

    <AlertDialog :open="deleteDialogOpen" @update:open="(v) => (deleteDialogOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              Часы за {{ formatDate(deleteTarget.workDate) }} будут удалены. Действие нельзя
              отменить
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
