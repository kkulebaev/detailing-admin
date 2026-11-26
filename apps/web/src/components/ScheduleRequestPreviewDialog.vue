<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  WEEKDAY_SHORT,
  datesOnClosedDays,
  isoDaysBetween,
  monthScheduleRange,
} from '@detailing-admin/shared'
import { STUDIO_CLOSED_SUFFIX, useStudioWeekdays } from '@/composables/use-studio-weekdays'
import { useScheduleQuery } from '@/lib/queries'
import type { ScheduleRequest } from '@/lib/schedule-requests-api'
import { MONTH_NAMES } from '@/lib/month-options'
import { dayLabel, formatDayList } from '@/lib/schedule-format'
import { ArrowRight, ChevronLeft, ChevronRight } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{
  request: ScheduleRequest | null
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  approve: [request: ScheduleRequest]
  reject: [request: ScheduleRequest]
}>()

const open = computed({
  get: () => props.request !== null,
  set: (v) => {
    if (!v && !props.busy) emit('close')
  },
})

// Заявка может задеть несколько месяцев, а график грузится помесячно, как на
// странице: так предпросмотр делит с ней кэш.
const months = computed(() =>
  [...new Set((props.request?.days ?? []).map((d) => d.date.slice(0, 7)))].sort(),
)
const monthIndex = ref(0)
watch(
  () => props.request?.id,
  () => {
    monthIndex.value = 0
  },
)
const month = computed(() => months.value[monthIndex.value] ?? null)
const range = computed(() => (month.value ? monthScheduleRange(month.value) : null))
const { data, error } = useScheduleQuery(range)
const { studioDays, closedDates, hasClosedDays, isDateClosed, isClosedWeekday } =
  useStudioWeekdays(range)

// Режим студии и выходные могли поменять после подачи заявки; сервер такую не одобрит.
// Выходные грузятся по показанному месяцу, поэтому и проверка — по его дням.
const closedAsked = computed(() =>
  datesOnClosedDays(
    studioDays.value,
    (props.request?.days ?? []).filter((d) => d.date.startsWith(month.value ?? '')),
    closedDates.value,
  ),
)

const monthTitle = computed(() => {
  if (!month.value) return ''
  const [y, m] = month.value.split('-').map(Number)
  return `${MONTH_NAMES[m! - 1]} ${y}`
})

// placeholderData держит прошлый месяц, пока грузится новый: его дни нельзя
// принять за график мастера в этом месяце.
const dataReady = computed(
  () => data.value?.ok === true && range.value !== null && data.value.from === range.value.from,
)

const loadError = computed<string | null>(() => {
  if (error.value) return 'Проверьте соединение и откройте заявку заново'
  const r = data.value
  if (r && !r.ok) return r.error === 'unavailable' ? r.message : 'Ошибка сервера'
  return null
})

const current = computed(() => {
  const set = new Set<string>()
  const r = props.request
  if (!r || !dataReady.value || !data.value?.ok) return set
  for (const d of data.value.schedule.find((s) => s.masterId === r.masterId)?.dates ?? []) {
    set.add(d)
  }
  return set
})

const requested = computed(
  () => new Map((props.request?.days ?? []).map((d) => [d.date, d.working] as const)),
)

const days = computed(() => {
  if (!range.value) return []
  return isoDaysBetween(range.value.from, range.value.to).map((iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
    const before = current.value.has(iso)
    const asked = requested.value.get(iso)
    return {
      iso,
      day: d!,
      weekday,
      closed: isDateClosed(iso),
      before,
      after: asked ?? before,
      asked: asked !== undefined,
    }
  })
})

const leadingBlanks = computed(() => days.value[0]?.weekday ?? 0)
const countBefore = computed(() => days.value.filter((d) => d.before).length)
const countAfter = computed(() => days.value.filter((d) => d.after).length)

// Те же обозначения, что в графике у сотрудника: запрошенный рабочий день бледнее,
// запрошенный выходной — пунктиром.
function cellClass(d: { after: boolean; asked: boolean; closed: boolean }): string {
  if (!d.asked) {
    if (d.after) return 'border-primary bg-primary text-primary-foreground'
    return d.closed ? 'closed-hatch border-border text-muted-foreground' : 'border-border'
  }
  return d.after
    ? 'border-primary bg-primary/50 text-primary-foreground'
    : 'border-dashed border-primary'
}

function cellLabel(d: {
  iso: string
  after: boolean
  asked: boolean
  before: boolean
  closed: boolean
}): string {
  const state = d.after ? 'рабочий' : 'выходной'
  const closed = d.closed ? STUDIO_CLOSED_SUFFIX : ''
  if (!d.asked) return `${dayLabel(d.iso)}: ${state}${closed}`
  return d.before === d.after
    ? `${dayLabel(d.iso)}: ${state}, по заявке без изменений${closed}`
    : `${dayLabel(d.iso)}: станет ${state}${closed}`
}
</script>

<template>
  <Dialog v-model:open="open">
    <!-- На низком телефоне календарь с легендой и кнопками выше экрана: без прокрутки
         кнопки решения оказались бы недоступны. -->
    <DialogContent class="max-h-svh overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ request?.masterName }}</DialogTitle>
        <DialogDescription>Заявка на изменение графика</DialogDescription>
      </DialogHeader>

      <div class="grid gap-3">
        <div class="flex items-center justify-between gap-2">
          <Button
            v-if="months.length > 1"
            variant="ghost"
            size="icon"
            class="size-9"
            aria-label="Предыдущий месяц заявки"
            :disabled="monthIndex === 0"
            @click="monthIndex--"
          >
            <ChevronLeft class="size-4" />
          </Button>
          <span class="flex-1 text-center text-sm font-medium">{{ monthTitle }}</span>
          <Button
            v-if="months.length > 1"
            variant="ghost"
            size="icon"
            class="size-9"
            aria-label="Следующий месяц заявки"
            :disabled="monthIndex >= months.length - 1"
            @click="monthIndex++"
          >
            <ChevronRight class="size-4" />
          </Button>
        </div>

        <p
          v-if="loadError"
          role="alert"
          class="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
        >
          Не удалось загрузить график: {{ loadError }}
        </p>
        <Skeleton v-else-if="!dataReady" class="h-64 w-full sm:h-72" />
        <template v-else>
          <div class="grid grid-cols-7 gap-1">
            <div
              v-for="(w, i) in WEEKDAY_SHORT"
              :key="w"
              class="text-center text-xs"
              :class="isClosedWeekday(i) ? 'text-destructive/80' : 'text-muted-foreground'"
            >
              {{ w }}
            </div>
            <div v-for="n in leadingBlanks" :key="`blank-${n}`" />
            <div
              v-for="d in days"
              :key="d.iso"
              role="img"
              class="flex h-9 items-center justify-center rounded-md border text-sm tabular-nums sm:h-10"
              :class="cellClass(d)"
              :aria-label="cellLabel(d)"
            >
              {{ d.day }}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span class="flex items-center gap-1.5">
              <span class="size-3 rounded-sm bg-primary" /> Рабочий
            </span>
            <span class="flex items-center gap-1.5">
              <span class="size-3 rounded-sm border border-primary bg-primary/50" /> Станет рабочим
            </span>
            <span class="flex items-center gap-1.5">
              <span class="size-3 rounded-sm border border-dashed border-primary" /> Станет выходным
            </span>
            <span v-if="hasClosedDays" class="flex items-center gap-1.5">
              <span class="closed-hatch size-3 rounded-sm border border-border" /> Студия закрыта
            </span>
          </div>

          <p
            v-if="closedAsked.length > 0"
            role="alert"
            class="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
          >
            Заявка просит рабочие дни, когда студия закрыта: {{ formatDayList(closedAsked) }}.
            Одобрить ее нельзя, только отклонить.
          </p>

          <p class="text-sm text-muted-foreground">
            Рабочих дней в месяце:
            <span
              class="inline-flex items-center gap-1 align-bottom font-medium text-foreground tabular-nums"
            >
              <template v-if="countBefore !== countAfter">
                {{ countBefore }}
                <ArrowRight class="size-3.5 text-muted-foreground" aria-label="станет" />
              </template>
              {{ countAfter }}
            </span>
          </p>
        </template>
      </div>

      <DialogFooter class="grid grid-cols-2 gap-2 sm:flex">
        <Button
          variant="outline"
          class="h-10 sm:h-9"
          :disabled="busy"
          @click="request && emit('reject', request)"
        >
          Отклонить
        </Button>
        <!-- Одобрять, не видя календаря, нельзя: предпросмотр затем и открыт. -->
        <Button
          class="h-10 sm:h-9"
          :disabled="busy || !dataReady || closedAsked.length > 0"
          @click="request && emit('approve', request)"
        >
          Одобрить
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
