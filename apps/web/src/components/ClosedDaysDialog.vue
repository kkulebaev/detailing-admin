<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useQueryCache } from '@pinia/colada'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Trash2 } from '@lucide/vue'
import {
  CLOSED_DAYS_MAX_BATCH,
  WEEKDAY_SHORT,
  isoDaysBetween,
  isoWeekday,
  monthScheduleRange,
} from '@detailing-admin/shared'
import { useStudioWeekdays } from '@/composables/use-studio-weekdays'
import { MONTH_NAMES } from '@/lib/month-options'
import { CLOSED_DAYS_KEY, useClosedDaysQuery } from '@/lib/queries'
import { addClosedDays, removeClosedDay } from '@/lib/schedule-api'
import { dayLabel } from '@/lib/schedule-format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

// Окно показывает выходные на год вперед: прошедшие уже ничего не ограничивают.
const AHEAD_DAYS = 365

const props = defineProps<{ open: boolean; today: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

const range = computed(() =>
  props.open ? { from: props.today, to: shiftIso(props.today, AHEAD_DAYS) } : null,
)
const { data, error } = useClosedDaysQuery(range)
const dates = computed(() => (data.value?.ok ? data.value.dates : null))
const failed = computed(() => error.value !== null || (data.value !== undefined && !data.value.ok))

// Тот же вид, что у календаря мастера в «Графике»: закрытые дни заштрихованы,
// выбранный диапазон залит. Первый тап — начало, второй — конец (тот же день — один день).
const start = ref<string | null>(null)
const end = ref<string | null>(null)

const maxDate = computed(() => shiftIso(props.today, AHEAD_DAYS))
const viewMonth = ref(props.today.slice(0, 7))
watch(
  () => props.open,
  (open) => {
    if (!open) return
    viewMonth.value = props.today.slice(0, 7)
    start.value = null
    end.value = null
  },
)

const { isDateClosed, isClosedWeekday } = useStudioWeekdays(range)

const monthTitle = computed(() => {
  const [y, m] = viewMonth.value.split('-').map(Number)
  return `${MONTH_NAMES[m! - 1]} ${y}`
})
const canPrev = computed(() => viewMonth.value > props.today.slice(0, 7))
const canNext = computed(() => viewMonth.value < maxDate.value.slice(0, 7))

function shiftMonth(delta: number) {
  const [y, m] = viewMonth.value.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1))
  viewMonth.value = d.toISOString().slice(0, 7)
}

const days = computed(() => {
  const r = monthScheduleRange(viewMonth.value)
  return isoDaysBetween(r.from, r.to).map((iso) => ({
    iso,
    day: Number(iso.slice(8)),
    disabled: iso < props.today || iso > maxDate.value,
    closed: isDateClosed(iso),
    today: iso === props.today,
  }))
})
const leadingBlanks = computed(() => (days.value[0] ? isoWeekday(days.value[0].iso) : 0))

function pick(iso: string) {
  if (busy.value) return
  if (start.value === null || end.value !== null) {
    start.value = iso
    end.value = null
  } else if (iso < start.value) {
    start.value = iso
  } else {
    end.value = iso
  }
}

function isSelected(iso: string): boolean {
  if (start.value === null) return false
  if (end.value === null) return iso === start.value
  return iso >= start.value && iso <= end.value
}

function cellClass(d: { iso: string; disabled: boolean; closed: boolean }): string {
  if (isSelected(d.iso)) {
    // Пока выбрано только начало, оно бледнее: диапазон еще не готов к добавлению.
    return end.value === null
      ? 'border-primary bg-primary/50 text-primary-foreground'
      : 'border-primary bg-primary text-primary-foreground'
  }
  if (d.disabled) return 'border-transparent text-muted-foreground/50'
  if (d.closed) return 'closed-hatch border-border text-muted-foreground'
  return 'border-border hover:bg-accent'
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
}

const selectedIso = computed(() =>
  start.value !== null && end.value !== null ? { from: start.value, to: end.value } : null,
)
const tooLong = computed(
  () =>
    selectedIso.value !== null &&
    daysBetween(selectedIso.value.from, selectedIso.value.to) > CLOSED_DAYS_MAX_BATCH,
)
const selectionLabel = computed(() => {
  if (start.value === null) return 'Выберите дни в календаре'
  if (end.value === null) return `${dayLabel(start.value)} – выберите конец`
  return start.value === end.value
    ? dayLabel(start.value)
    : `${dayLabel(start.value)} – ${dayLabel(end.value)}`
})

const busy = ref(false)
const queryCache = useQueryCache()

async function run(action: () => Promise<{ ok: boolean }>, success: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    const result = await action()
    if (!result.ok) {
      toast.error('Не удалось сохранить выходной')
      return false
    }
    // Сетка графика и форма записи держат свои периоды — перечитываются все.
    await queryCache.invalidateQueries({ key: CLOSED_DAYS_KEY }).catch(() => {})
    toast.success(success)
    return true
  } catch {
    toast.error('Не удалось сохранить выходной')
    return false
  } finally {
    busy.value = false
  }
}

async function add() {
  const r = selectedIso.value
  if (!r || tooLong.value) return
  const single = r.from === r.to
  const ok = await run(() => addClosedDays(r), single ? 'Выходной добавлен' : 'Выходные добавлены')
  if (ok) {
    start.value = null
    end.value = null
  }
}

function remove(group: DayGroup) {
  return run(
    async () => {
      const results = await Promise.all(group.dates.map((d) => removeClosedDay(d)))
      return { ok: results.every((x) => x.ok) }
    },
    group.dates.length === 1 ? 'Выходной удален' : 'Выходные удалены',
  )
}

interface DayGroup {
  from: string
  to: string
  dates: string[]
}

// Подряд идущие даты сворачиваются в один диапазон, чтобы длинные каникулы не занимали весь список.
const groups = computed<DayGroup[]>(() => {
  const out: DayGroup[] = []
  for (const d of dates.value ?? []) {
    const last = out[out.length - 1]
    if (last && shiftIso(last.to, 1) === d) {
      last.to = d
      last.dates.push(d)
    } else {
      out.push({ from: d, to: d, dates: [d] })
    }
  }
  return out
})

function label(g: DayGroup): string {
  if (g.from === g.to) {
    return `${dayLabel(g.from)}, ${WEEKDAY_SHORT[isoWeekday(g.from)]!.toLowerCase()}`
  }
  return `${dayLabel(g.from)} – ${dayLabel(g.to)}`
}

function removeLabel(g: DayGroup): string {
  return g.from === g.to
    ? `Удалить выходной: ${dayLabel(g.from)}`
    : `Удалить выходные: ${dayLabel(g.from)} – ${dayLabel(g.to)}`
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-h-svh overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Добавить выходные</DialogTitle>
        <DialogDescription> Выберите дни, когда студия будет закрыта </DialogDescription>
      </DialogHeader>

      <form class="grid gap-2" @submit.prevent="add">
        <div class="rounded-md border border-border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-9"
              aria-label="Предыдущий месяц"
              :disabled="!canPrev"
              @click="shiftMonth(-1)"
            >
              <ChevronLeft class="size-4" />
            </Button>
            <span class="text-sm font-medium">{{ monthTitle }}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-9"
              aria-label="Следующий месяц"
              :disabled="!canNext"
              @click="shiftMonth(1)"
            >
              <ChevronRight class="size-4" />
            </Button>
          </div>
          <div class="mb-2 grid grid-cols-7 gap-1">
            <div
              v-for="(w, i) in WEEKDAY_SHORT"
              :key="w"
              class="text-center text-xs"
              :class="isClosedWeekday(i) ? 'text-destructive/80' : 'text-muted-foreground'"
            >
              {{ w }}
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1">
            <div v-for="b in leadingBlanks" :key="`blank-${b}`" />
            <button
              v-for="d in days"
              :key="d.iso"
              type="button"
              class="flex h-11 items-center justify-center rounded-md border text-sm tabular-nums transition-colors disabled:cursor-not-allowed"
              :class="[cellClass(d), { 'ring-2 ring-foreground ring-offset-1': d.today }]"
              :disabled="d.disabled || busy"
              :aria-pressed="isSelected(d.iso)"
              :aria-label="`${dayLabel(d.iso)}${d.closed ? ', выходной' : ''}`"
              @click="pick(d.iso)"
            >
              {{ d.day }}
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="flex flex-1 items-center gap-2 text-sm"
            :class="{ 'text-muted-foreground': !selectedIso }"
            aria-live="polite"
          >
            <CalendarIcon class="size-4 shrink-0" />
            {{ selectionLabel }}
          </span>
          <Button type="submit" class="h-10" :disabled="busy || !selectedIso || tooLong">
            Добавить
          </Button>
        </div>
        <p v-if="tooLong" role="alert" class="text-sm text-destructive">
          Не больше {{ CLOSED_DAYS_MAX_BATCH }} дней за раз
        </p>
      </form>

      <p v-if="failed" role="alert" class="text-sm text-destructive">
        Не удалось загрузить выходные
      </p>
      <Skeleton v-else-if="dates === null" class="h-24 w-full" />
      <ul
        v-else-if="dates.length > 0"
        class="divide-y divide-border rounded-md border border-border"
      >
        <li v-for="g in groups" :key="g.from" class="flex min-h-12 items-center gap-3 px-3 py-1">
          <span class="flex-1 text-sm">{{ label(g) }}</span>
          <Button
            variant="ghost"
            size="icon"
            class="size-9 text-muted-foreground"
            :disabled="busy"
            :aria-label="removeLabel(g)"
            @click="remove(g)"
          >
            <Trash2 class="size-4" />
          </Button>
        </li>
      </ul>
    </DialogContent>
  </Dialog>
</template>
