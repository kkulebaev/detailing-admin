<script setup lang="ts">
import { computed } from 'vue'
import { Inbox, Pencil, Trash2 } from '@lucide/vue'
import { minutesToHours, salaryEntryDate, type SalaryEntry } from '@detailing-admin/shared'
import { useSalaryEntriesQuery } from '@/lib/queries'
import { formatAmount, formatSigned } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'

const props = defineProps<{ masterId: number; month: string; columnCount: number }>()
const emit = defineEmits<{ edit: [SalaryEntry]; delete: [SalaryEntry] }>()

// Own query per expanded master → several masters can stay open at once, each
// with its own cache entry. useInvalidateSalaryEntries (prefix key) refreshes
// all. Hours and payouts arrive as one sorted feed, so there is a single
// loading/error state here rather than a combination of two.
const { data, error: queryError, asyncStatus } = useSalaryEntriesQuery(
  computed<number | null>(() => props.masterId),
  computed(() => props.month),
)

const entries = computed<SalaryEntry[]>(() => {
  const r = data.value
  return r?.ok ? r.entries : []
})

const loading = computed(
  () => asyncStatus.value === 'loading' && data.value === undefined,
)

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке записей'
  const r = data.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить записи'
})

function formatHours(minutes: number): string {
  return minutesToHours(minutes).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// What this one record is worth: minutes × rate / 60, deliberately NOT rounded
// per row. The month's total is rounded once (salaryFromMinutesRateSum), so
// rounding each row here would make the rows add up to something other than the
// master's «За часы». A quarter-hour at an odd rate is the only case that shows
// a fraction — ru-RU renders it with a comma.
function formatEntryAmount(minutes: number, rate: number): string {
  return ((minutes * rate) / 60).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
// "2026-01-22" → "22 января 2026 г." Build the Date from parts (local midnight)
// so it never shifts a day across the UTC boundary the way `new Date(iso)` would.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
</script>

<template>
  <TableRow v-if="loading" class="bg-muted hover:bg-muted">
    <TableCell :colspan="columnCount" class="py-2 pr-4 pl-6">
      <div class="border-l-2 border-muted-foreground/30 pl-4">
        <Skeleton class="h-4 w-full" />
      </div>
    </TableCell>
  </TableRow>

  <TableRow v-else-if="error" class="bg-muted hover:bg-muted">
    <TableCell :colspan="columnCount" class="py-2 pr-4 pl-6 text-sm text-destructive">
      <div class="border-l-2 border-muted-foreground/30 pl-4">{{ error }}</div>
    </TableCell>
  </TableRow>

  <!-- Auto-expand only opens rows that have data, but the chevron opens any of
       them: without this row a manual expand would toggle the button and show
       nothing at all. -->
  <TableRow v-else-if="entries.length === 0" class="bg-muted hover:bg-muted">
    <TableCell :colspan="columnCount" class="py-3 pr-4 pl-6 text-sm text-muted-foreground">
      <div class="border-l-2 border-muted-foreground/30 pl-4">
        <span class="inline-flex items-center gap-2">
          <Inbox class="size-3.5" /> Нет часов и выплат за месяц
        </span>
      </div>
    </TableCell>
  </TableRow>

  <!-- Ids are unique per table, not across the two — the kind prefix keeps the
       key unique when an hours row and a payout share an id. -->
  <TableRow
    v-else
    v-for="entry in entries"
    :key="`${entry.kind}-${entry.id}`"
    class="bg-muted hover:bg-muted/70"
  >
    <TableCell class="py-2 pr-4 pl-6 align-middle whitespace-normal">
      <div class="border-l-2 border-muted-foreground/30 pl-4">
        <div class="tabular-nums">{{ formatDate(salaryEntryDate(entry)) }}</div>
        <div v-if="entry.note" class="text-xs text-muted-foreground">{{ entry.note }}</div>
      </div>
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle tabular-nums text-muted-foreground">
      {{ entry.kind === 'hours' ? formatAmount(entry.rateSnapshot) : '—' }}
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle tabular-nums">
      {{ entry.kind === 'hours' ? formatHours(entry.minutes) : '—' }}
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle tabular-nums text-muted-foreground">
      {{ entry.kind === 'hours' ? formatEntryAmount(entry.minutes, entry.rateSnapshot) : '—' }}
    </TableCell>
    <TableCell
      class="px-4 py-2 text-right align-middle tabular-nums"
      :class="{
        'text-muted-foreground': entry.kind === 'hours',
        'text-destructive': entry.kind === 'payout' && entry.amount < 0,
      }"
    >
      {{ entry.kind === 'payout' ? formatSigned(entry.amount) : '—' }}
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle text-muted-foreground">—</TableCell>
    <TableCell class="px-4 py-2 text-right align-middle">
      <div class="inline-flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          :title="entry.kind === 'hours' ? 'Редактировать запись' : 'Редактировать выплату'"
          :aria-label="`${
            entry.kind === 'hours' ? 'Редактировать запись' : 'Редактировать выплату'
          } за ${formatDate(salaryEntryDate(entry))}`"
          @click="emit('edit', entry)"
        >
          <Pencil class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :title="entry.kind === 'hours' ? 'Удалить запись' : 'Удалить выплату'"
          :aria-label="`${
            entry.kind === 'hours' ? 'Удалить запись' : 'Удалить выплату'
          } за ${formatDate(salaryEntryDate(entry))}`"
          @click="emit('delete', entry)"
        >
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </TableCell>
  </TableRow>
</template>
