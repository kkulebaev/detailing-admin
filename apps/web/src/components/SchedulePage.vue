<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue-sonner'
import { getLocalTimeZone, today } from '@internationalized/date'
import { isoDaysBetween, monthScheduleRange } from '@detailing-admin/shared'
import { buildMonthOptions, currentMonthKey } from '@/lib/month-options'
import { SCHEDULE_KEY, useMastersQuery, useScheduleQuery } from '@/lib/queries'
import { saveSchedule } from '@/lib/schedule-api'
import { useAuthStore } from '@/stores/auth'
import { useQueryCache } from '@pinia/colada'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

const auth = useAuthStore()
const canEdit = computed(() => auth.isAdmin)
const isWideScreen = useMediaQuery('(min-width: 768px)')

const month = ref(currentMonthKey())
// График составляют наперед, поэтому вперед смотрим дальше, чем на странице зарплат.
const monthOptions = buildMonthOptions(3, 12)
const range = computed(() => monthScheduleRange(month.value))

const { data: scheduleData, error: scheduleError, asyncStatus } = useScheduleQuery(range)
const { data: mastersData, error: mastersError } = useMastersQuery()
const queryCache = useQueryCache()

const masters = computed(() => (mastersData.value?.ok ? mastersData.value.masters : []))

const todayIso = today(getLocalTimeZone()).toString()
const days = computed(() =>
  isoDaysBetween(range.value.from, range.value.to).map((iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
    return { iso, day: d!, weekday, weekend: weekday >= 5, today: iso === todayIso }
  }),
)

// Пустые ячейки перед первым числом, чтобы календарь на телефоне начинался с понедельника.
const leadingBlanks = computed(() => days.value[0]?.weekday ?? 0)

// Черновик админа: только дни, отличные от сохраненных. Переживает смену месяца
// и мастера, чтобы график можно было заполнить целиком и сохранить одним разом.
const drafts = reactive(new Map<string, boolean>())
const saving = ref(false)
const dirtyCount = computed(() => drafts.size)

// placeholderData держит прошлый месяц, пока грузится новый: без этой сверки новый
// месяц на мгновение выглядел бы пустым, и админ мог бы начать заполнять его заново.
const dataReady = computed(
  () => scheduleData.value?.ok === true && scheduleData.value.from === range.value.from,
)

const serverWorking = computed(() => {
  const set = new Set<string>()
  if (!dataReady.value || !scheduleData.value?.ok) return set
  for (const s of scheduleData.value.schedule) {
    for (const d of s.dates) set.add(`${s.masterId}|${d}`)
  }
  return set
})

function isWorking(masterId: number, iso: string): boolean {
  const key = `${masterId}|${iso}`
  return drafts.get(key) ?? serverWorking.value.has(key)
}

function isDraft(masterId: number, iso: string): boolean {
  return drafts.has(`${masterId}|${iso}`)
}

function cellClass(masterId: number, iso: string, filled: string): string {
  const working = isWorking(masterId, iso)
  if (!isDraft(masterId, iso))
    return working ? `border-primary bg-primary ${filled}` : 'border-border'
  // Несохраненная отметка бледнее сохраненной, а снятая — пунктиром, чтобы до
  // сохранения было видно, что именно изменится.
  return working ? `border-primary bg-primary/50 ${filled}` : 'border-dashed border-primary'
}

function workingCount(masterId: number): number {
  return days.value.filter((d) => isWorking(masterId, d.iso)).length
}

function toggle(masterId: number, iso: string) {
  if (!canEdit.value || !dataReady.value || saving.value) return
  const key = `${masterId}|${iso}`
  const working = !isWorking(masterId, iso)
  if (working === serverWorking.value.has(key)) drafts.delete(key)
  else drafts.set(key, working)
}

async function save() {
  if (saving.value || drafts.size === 0) return
  const days = [...drafts].map(([key, working]) => {
    const [masterId, date] = key.split('|')
    return { masterId: Number(masterId), date: date!, working }
  })
  saving.value = true
  try {
    const result = await saveSchedule({ days })
    if (!result.ok) {
      toast.error(
        result.error === 'not_found'
          ? 'Мастер не найден — обновите страницу'
          : result.error === 'unavailable'
            ? result.message
            : 'Не удалось сохранить график',
      )
      return
    }
    // Черновик снимается после перечитывания, иначе ячейки на миг мигнули бы старым
    // графиком. Форма записи держит свои диапазоны графика — пусть тоже перечитает.
    await queryCache.invalidateQueries({ key: SCHEDULE_KEY }).catch(() => {})
    drafts.clear()
    toast.success('График сохранен')
  } catch {
    toast.error('Не удалось сохранить график')
  } finally {
    saving.value = false
  }
}

function discard() {
  drafts.clear()
}

const LEAVE_PROMPT = 'Есть несохраненные изменения графика. Уйти без сохранения?'
onBeforeRouteLeave(() => drafts.size === 0 || window.confirm(LEAVE_PROMPT))
useEventListener(window, 'beforeunload', (e: BeforeUnloadEvent) => {
  if (drafts.size > 0) e.preventDefault()
})

function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS_GENITIVE[m! - 1]}`
}

const selectedMasterId = ref<string>('')
watch(
  masters,
  (list) => {
    if (!list.some((m) => String(m.id) === selectedMasterId.value)) {
      selectedMasterId.value = list[0] ? String(list[0].id) : ''
    }
  },
  { immediate: true },
)
const selectedMaster = computed(() =>
  masters.value.find((m) => String(m.id) === selectedMasterId.value),
)

const error = computed<string | null>(() => {
  if (scheduleError.value || mastersError.value) return 'Проверьте соединение и обновите страницу'
  const r = scheduleData.value
  if (r && !r.ok) return r.error === 'unavailable' ? r.message : 'Ошибка сервера'
  const m = mastersData.value
  if (m && !m.ok) return m.error === 'unavailable' ? m.message : 'Ошибка сервера'
  return null
})

const showSkeleton = computed(
  () => (!dataReady.value || mastersData.value === undefined) && asyncStatus.value === 'loading',
)
</script>

<template>
  <div class="min-h-svh bg-background p-2 text-foreground sm:p-8">
    <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">График</h1>
        <p v-if="canEdit" class="mt-1 text-sm text-muted-foreground">
          Отметьте рабочие дни и нажмите «Сохранить»
        </p>
      </div>
    </header>

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

      <div v-if="!isWideScreen && masters.length > 0" class="flex w-full flex-col gap-1">
        <span class="text-xs text-muted-foreground">Мастер</span>
        <Select v-model="selectedMasterId">
          <SelectTrigger size="sm" class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="m in masters" :key="m.id" :value="String(m.id)">
              {{ m.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex items-center gap-4 text-xs text-muted-foreground sm:ml-auto">
        <span class="flex items-center gap-1.5">
          <span class="size-3 rounded-sm bg-primary" /> Рабочий
        </span>
        <span class="flex items-center gap-1.5">
          <span class="size-3 rounded-sm border border-border" /> Выходной
        </span>
      </div>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertTitle>Не удалось загрузить график</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Skeleton v-else-if="showSkeleton" :class="isWideScreen ? 'h-64 w-full' : 'h-80 w-full'" />

    <p
      v-else-if="masters.length === 0"
      class="rounded-md border border-border p-6 text-center text-sm text-muted-foreground"
    >
      Мастеров пока нет
    </p>

    <!-- Широкий экран: все мастера сразу, чтобы видеть, кто с кем пересекается. -->
    <div v-else-if="isWideScreen" class="overflow-x-auto rounded-md border border-border">
      <table class="border-collapse text-sm">
        <thead>
          <tr class="border-b border-border">
            <th class="sticky left-0 z-10 min-w-44 bg-background px-3 py-2 text-left font-medium">
              Мастер
            </th>
            <th
              v-for="d in days"
              :key="d.iso"
              class="w-10 min-w-10 px-0 py-1 text-center font-normal"
              :class="{ 'bg-muted/60': d.weekend }"
            >
              <div
                class="text-xs"
                :class="d.weekend ? 'text-destructive/80' : 'text-muted-foreground'"
              >
                {{ WEEKDAYS[d.weekday] }}
              </div>
              <div
                class="mx-auto flex size-6 items-center justify-center rounded-full tabular-nums"
                :class="{ 'bg-foreground font-semibold text-background': d.today }"
              >
                {{ d.day }}
              </div>
            </th>
            <th class="px-3 py-2 text-right font-medium">Дней</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in masters" :key="m.id" class="border-b border-border last:border-b-0">
            <td class="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium">
              {{ m.name }}
            </td>
            <td v-for="d in days" :key="d.iso" class="p-0.5" :class="{ 'bg-muted/60': d.weekend }">
              <button
                v-if="canEdit"
                type="button"
                class="block size-9 rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :class="[
                  cellClass(m.id, d.iso, 'hover:bg-primary/85'),
                  { 'hover:bg-accent': !isWorking(m.id, d.iso) },
                ]"
                :aria-pressed="isWorking(m.id, d.iso)"
                :aria-label="`${m.name}, ${dayLabel(d.iso)}`"
                @click="toggle(m.id, d.iso)"
              />
              <div
                v-else
                role="img"
                class="size-9 rounded-md border"
                :class="isWorking(m.id, d.iso) ? 'border-primary bg-primary' : 'border-border'"
                :aria-label="`${m.name}, ${dayLabel(d.iso)}: ${isWorking(m.id, d.iso) ? 'рабочий' : 'выходной'}`"
              />
            </td>
            <td class="px-3 text-right tabular-nums">{{ workingCount(m.id) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Телефон: месяц одного мастера календарем, ячейки под палец. -->
    <div v-else-if="selectedMaster" class="rounded-md border border-border p-3">
      <div class="mb-2 grid grid-cols-7 gap-1">
        <div
          v-for="(w, i) in WEEKDAYS"
          :key="w"
          class="text-center text-xs"
          :class="i >= 5 ? 'text-destructive/80' : 'text-muted-foreground'"
        >
          {{ w }}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-1">
        <div v-for="n in leadingBlanks" :key="`blank-${n}`" />
        <component
          :is="canEdit ? 'button' : 'div'"
          :role="canEdit ? undefined : 'img'"
          v-for="d in days"
          :key="d.iso"
          :type="canEdit ? 'button' : undefined"
          class="flex h-11 items-center justify-center rounded-md border text-sm tabular-nums transition-colors"
          :class="[
            cellClass(selectedMaster.id, d.iso, 'text-primary-foreground'),
            { 'ring-2 ring-foreground ring-offset-1': d.today },
          ]"
          :aria-pressed="canEdit ? isWorking(selectedMaster.id, d.iso) : undefined"
          :aria-label="`${dayLabel(d.iso)}: ${isWorking(selectedMaster.id, d.iso) ? 'рабочий' : 'выходной'}`"
          @click="toggle(selectedMaster.id, d.iso)"
        >
          {{ d.day }}
        </component>
      </div>
      <p class="mt-3 text-sm text-muted-foreground">
        Рабочих дней: <span class="tabular-nums">{{ workingCount(selectedMaster.id) }}</span>
      </p>
    </div>

    <div
      v-if="canEdit && dirtyCount > 0"
      class="sticky bottom-2 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-3 shadow-md"
    >
      <span class="text-sm">
        Несохраненных изменений: <span class="tabular-nums">{{ dirtyCount }}</span>
      </span>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" :disabled="saving" @click="discard">Отменить</Button>
        <Button size="sm" :disabled="saving" @click="save">
          {{ saving ? 'Сохранение…' : 'Сохранить' }}
        </Button>
      </div>
    </div>
  </div>
</template>
