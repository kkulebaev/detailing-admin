<script setup lang="ts">
import { computed } from 'vue'
import { Clock, Pencil, Trash2 } from '@lucide/vue'
import { minutesToHours, type WorkHours } from '@detailing-admin/shared'
import { useWorkHoursQuery } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'

const props = defineProps<{ masterId: number; month: string; columnCount: number }>()
const emit = defineEmits<{ edit: [WorkHours]; delete: [WorkHours] }>()

// Own query per expanded master → several masters can stay open at once, each
// with its own cache entry. useInvalidateWorkHours (prefix key) refreshes all.
const { data, error: queryError, asyncStatus } = useWorkHoursQuery(
  computed<number | null>(() => props.masterId),
  computed(() => props.month),
)

const entries = computed<WorkHours[]>(() => {
  const r = data.value
  return r?.ok ? r.hours : []
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

function formatAmount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
function formatHours(minutes: number): string {
  return minutesToHours(minutes).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
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

  <TableRow v-else-if="entries.length === 0" class="bg-muted hover:bg-muted">
    <TableCell :colspan="columnCount" class="py-3 pr-4 pl-6 text-sm text-muted-foreground">
      <div class="border-l-2 border-muted-foreground/30 pl-4">
        <span class="inline-flex items-center gap-2">
          <Clock class="size-3.5" /> Нет записей за месяц — добавьте кнопкой ＋
        </span>
      </div>
    </TableCell>
  </TableRow>

  <TableRow
    v-else
    v-for="entry in entries"
    :key="entry.id"
    class="bg-muted hover:bg-muted/70"
  >
    <TableCell class="py-2 pr-4 pl-6 align-middle whitespace-normal">
      <div class="border-l-2 border-muted-foreground/30 pl-4">
        <div class="tabular-nums">{{ formatDate(entry.workDate) }}</div>
        <div v-if="entry.note" class="text-xs text-muted-foreground">{{ entry.note }}</div>
      </div>
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle tabular-nums text-muted-foreground">
      {{ formatAmount(entry.rateSnapshot) }}
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle tabular-nums">
      {{ formatHours(entry.minutes) }}
    </TableCell>
    <TableCell class="px-4 py-2 text-right align-middle text-muted-foreground">—</TableCell>
    <TableCell class="px-4 py-2 text-right align-middle">
      <div class="inline-flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Редактировать запись"
          @click="emit('edit', entry)"
        >
          <Pencil class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Удалить запись"
          @click="emit('delete', entry)"
        >
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </TableCell>
  </TableRow>
</template>
