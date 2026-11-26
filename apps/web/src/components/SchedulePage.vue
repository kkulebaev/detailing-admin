<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue-sonner'
import { getLocalTimeZone, today } from '@internationalized/date'
import {
  WEEKDAY_SHORT,
  formatStudioHours,
  isoDaysBetween,
  monthScheduleRange,
} from '@detailing-admin/shared'
import { buildMonthOptions, currentMonthKey } from '@/lib/month-options'
import { monthParam, useQueryParam } from '@/composables/use-query-param'
import {
  MY_SCHEDULE_REQUESTS_KEY,
  SCHEDULE_KEY,
  useMastersQuery,
  useMyScheduleRequestsQuery,
  useScheduleBookingsQuery,
  useScheduleQuery,
} from '@/lib/queries'
import { STUDIO_CLOSED_SUFFIX, useStudioWeekdays } from '@/composables/use-studio-weekdays'
import { saveSchedule } from '@/lib/schedule-api'
import { submitScheduleRequest } from '@/lib/schedule-requests-api'
import { dayLabel, describeDayBookings, formatDayList, weekdayName } from '@/lib/schedule-format'
import type { ScheduleBooking } from '@/lib/schedule-api'
import { useAuthStore } from '@/stores/auth'
import { useQueryCache } from '@pinia/colada'
import MyScheduleRequestCard from '@/components/MyScheduleRequestCard.vue'
import ScheduleRequestsPanel from '@/components/ScheduleRequestsPanel.vue'
import StudioHoursDialog from '@/components/StudioHoursDialog.vue'
import ClosedDaysDialog from '@/components/ClosedDaysDialog.vue'
import BookingMark from '@/components/ScheduleBookingMark.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  ClipboardList,
  Clock,
  TriangleAlert,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const auth = useAuthStore()
// Админ правит график напрямую, остальные — заявкой на согласование своего мастера.
const canEdit = computed(() => auth.isAdmin)
const isWideScreen = useMediaQuery('(min-width: 768px)')

// График составляют наперед, поэтому вперед смотрим дальше, чем на странице зарплат.
const monthOptions = buildMonthOptions(3, 12)

const month = ref(currentMonthKey())
useQueryParam('month', month, monthParam(monthOptions, currentMonthKey))
const range = computed(() => monthScheduleRange(month.value))

const { data: scheduleData, error: scheduleError, asyncStatus } = useScheduleQuery(range)
const { data: mastersData, error: mastersError } = useMastersQuery()
// Без ошибки на экране: отметки записей — подсказка, график без них остается рабочим.
const { data: bookingsData, error: bookingsError } = useScheduleBookingsQuery(range)
// Нужен всем ролям: по нему страница узнает своего мастера и выделяет его строку,
// в том числе у админа, привязанного к мастеру.
const { data: myRequestsData } = useMyScheduleRequestsQuery(computed(() => true))
const {
  data: studioHoursData,
  hasClosedDays,
  isOneOffClosed,
  isDateClosed,
  isClosedWeekday,
} = useStudioWeekdays(range)
const studioHoursOpen = ref(false)
const closedDaysOpen = ref(false)
const queryCache = useQueryCache()

// Без ответа сервера кнопки нет: пустой режим в диалоге затер бы сохраненный.
const studioDays = computed(() => (studioHoursData.value?.ok ? studioHoursData.value.days : null))
const studioHoursLines = computed(() =>
  studioDays.value && studioDays.value.length > 0 ? formatStudioHours(studioDays.value) : null,
)

const masters = computed(() => (mastersData.value?.ok ? mastersData.value.masters : []))

const myRequests = computed(() => (myRequestsData.value?.ok ? myRequestsData.value : null))
const ownMasterId = computed(() => myRequests.value?.masterId ?? null)
const pendingRequest = computed(
  () => myRequests.value?.requests.find((r) => r.status === 'pending') ?? null,
)
// Наложение заявки исчезает, как только перечитан список заявок, а одобренные дни
// приходят отдельным запросом графика. Без перечитывания график на это время
// показал бы дни откатившимися.
watch(
  () => pendingRequest.value?.id,
  (now, before) => {
    if (before !== undefined && now !== before) {
      void queryCache.invalidateQueries({ key: SCHEDULE_KEY }).catch(() => {})
    }
  },
)

// Новую заявку не подать, пока прежняя ждет решения.
const canRequest = computed(
  () => !canEdit.value && ownMasterId.value !== null && pendingRequest.value === null,
)

// «Сегодня» — день студии с сервера, а не по часам телефона.
const todayIso = computed(() => myRequests.value?.today ?? today(getLocalTimeZone()).toString())
const days = computed(() =>
  isoDaysBetween(range.value.from, range.value.to).map((iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    const weekday = (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
    return {
      iso,
      day: d!,
      weekday,
      weekend: isClosedWeekday(weekday) || isOneOffClosed(iso),
      closed: isDateClosed(iso),
      today: iso === todayIso.value,
    }
  }),
)

// Пустые ячейки перед первым числом, чтобы календарь на телефоне начинался с понедельника.
const leadingBlanks = computed(() => days.value[0]?.weekday ?? 0)

// Черновик: только дни, отличные от сохраненных. Переживает смену месяца и мастера,
// чтобы график можно было заполнить целиком и сохранить (или отправить) одним разом.
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

const bookingsByCell = computed(() => {
  const map = new Map<string, ScheduleBooking[]>()
  const r = bookingsData.value
  if (!r?.ok || r.from !== range.value.from) return map
  for (const d of r.days) map.set(`${d.masterId}|${d.date}`, d.bookings)
  return map
})

function bookingCount(masterId: number, iso: string): number {
  return bookingsByCell.value.get(`${masterId}|${iso}`)?.length ?? 0
}

// Учитывает черновик и заявку: снятие дня с записью сразу видно до сохранения.
function hasConflict(masterId: number, iso: string): boolean {
  return bookingCount(masterId, iso) > 0 && !isWorking(masterId, iso)
}

// Легенда описывает только то, что на экране: на телефоне виден один мастер.
const visibleBookingKeys = computed(() => {
  const keys = [...bookingsByCell.value.keys()]
  if (isWideScreen.value) return keys
  const prefix = `${selectedMaster.value?.id}|`
  return keys.filter((key) => key.startsWith(prefix))
})

const hasVisibleBookings = computed(() => visibleBookingKeys.value.length > 0)

const hasConflicts = computed(() =>
  visibleBookingKeys.value.some((key) => {
    const [masterId, iso] = key.split('|')
    return !isWorking(Number(masterId), iso!)
  }),
)

// Ячейка спрашивает текст и для title, и для aria-label на каждом рендере сетки.
const bookingsText = computed(() => {
  const map = new Map<string, { title: string; label: string }>()
  for (const [key, list] of bookingsByCell.value) map.set(key, describeDayBookings(list))
  return map
})

function bookingsTitle(masterId: number, iso: string): string | undefined {
  return bookingsText.value.get(`${masterId}|${iso}`)?.title
}

// Конфликт назван словами: красная рамка не видна программе чтения с экрана.
function bookingsLabel(masterId: number, iso: string): string {
  const text = bookingsText.value.get(`${masterId}|${iso}`)
  if (!text) return ''
  return `${hasConflict(masterId, iso) ? ', запись в выходной' : ''}, ${text.label}`
}

// Дни из заявки на согласовании рисуются поверх графика, как черновик: сотрудник
// видит, что попросил, пока админ не решил.
const requested = computed(() => {
  const map = new Map<string, boolean>()
  const r = pendingRequest.value
  if (r) for (const d of r.days) map.set(`${r.masterId}|${d.date}`, d.working)
  return map
})

function isWorking(masterId: number, iso: string): boolean {
  const key = `${masterId}|${iso}`
  return drafts.get(key) ?? requested.value.get(key) ?? serverWorking.value.has(key)
}

function isChanged(masterId: number, iso: string): boolean {
  const key = `${masterId}|${iso}`
  return drafts.has(key) || requested.value.has(key)
}

function canToggle(masterId: number): boolean {
  if (canEdit.value) return true
  return canRequest.value && masterId === ownMasterId.value
}

function isOwn(masterId: number): boolean {
  return masterId === ownMasterId.value
}

function cellClass(masterId: number, iso: string, filled: string, closed = false): string {
  const working = isWorking(masterId, iso)
  // Запись в выходной мастера — красным: ее надо развести с графиком.
  const conflict = hasConflict(masterId, iso)
  if (!isChanged(masterId, iso)) {
    if (working) return `border-primary bg-primary ${filled}`
    if (conflict) return `${closed ? 'closed-hatch ' : ''}border-destructive text-destructive`
    // Мастер, отмеченный в день закрытия, остается обычной заливкой — так он заметнее.
    return closed ? 'closed-hatch border-border text-muted-foreground' : 'border-border'
  }
  // Несохраненная отметка бледнее сохраненной, а снятая — пунктиром, чтобы до
  // сохранения было видно, что именно изменится.
  if (working) return `border-primary bg-primary/50 ${filled}`
  return conflict
    ? 'border-dashed border-destructive text-destructive'
    : 'border-dashed border-primary'
}

function workingCount(masterId: number): number {
  return days.value.filter((d) => isWorking(masterId, d.iso)).length
}

// В выходной студии день можно только снять — так убирают отметки, оставшиеся
// с прежнего режима, — но не поставить.
function isLocked(masterId: number, iso: string): boolean {
  return isDateClosed(iso) && !isWorking(masterId, iso)
}

function toggle(masterId: number, iso: string) {
  if (!canToggle(masterId) || !dataReady.value || saving.value) return
  if (isLocked(masterId, iso)) return
  setWorking(masterId, iso, !isWorking(masterId, iso))
}

function setWorking(masterId: number, iso: string, working: boolean) {
  const key = `${masterId}|${iso}`
  if (working === serverWorking.value.has(key)) drafts.delete(key)
  else drafts.set(key, working)
}

function isMonthFull(masterId: number): boolean {
  return days.value.every((d) => d.closed || isWorking(masterId, d.iso))
}

// Повторное нажатие на заполненный месяц снимает все дни: так одна кнопка
// и заполняет месяц, и сбрасывает его, чтобы начать отметки заново.
function toggleMonth(masterId: number) {
  if (!canToggle(masterId) || !dataReady.value || saving.value) return
  const working = !isMonthFull(masterId)
  for (const d of days.value) {
    if (working && d.closed) continue
    setWorking(masterId, d.iso, working)
  }
}

function draftDays() {
  return [...drafts].map(([key, working]) => {
    const [masterId, date] = key.split('|')
    return { masterId: Number(masterId), date: date!, working }
  })
}

async function saveAsAdmin() {
  const result = await saveSchedule({ days: draftDays() })
  if (!result.ok) {
    toast.error(
      'dates' in result
        ? `Студия закрыта: ${formatDayList(result.dates)}`
        : result.error === 'not_found'
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
}

const REQUEST_ERRORS = {
  not_linked: 'Аккаунт не привязан к мастеру — обратитесь к администратору',
  too_far: 'Так далеко вперед заявку подать нельзя',
} as const

async function sendRequest() {
  const result = await submitScheduleRequest({
    days: draftDays().map(({ date, working }) => ({ date, working })),
  })
  if (!result.ok) {
    if (result.error === 'validation') {
      if (!('reason' in result)) toast.error('Проверьте выбранные дни')
      else if (result.reason === 'studio_closed')
        toast.error(`Студия закрыта: ${formatDayList(result.dates)}`)
      else toast.error(REQUEST_ERRORS[result.reason])
    } else if (result.error === 'conflict') {
      toast.error('У вас уже есть заявка на согласовании')
    } else if (result.error === 'unavailable') {
      toast.error(result.message)
    } else {
      toast.error('Не удалось отправить заявку')
    }
    return
  }
  await queryCache.invalidateQueries({ key: MY_SCHEDULE_REQUESTS_KEY }).catch(() => {})
  drafts.clear()
  toast.success('Заявка отправлена на согласование')
}

async function save() {
  if (saving.value || drafts.size === 0) return
  saving.value = true
  try {
    await (canEdit.value ? saveAsAdmin() : sendRequest())
  } catch {
    toast.error(canEdit.value ? 'Не удалось сохранить график' : 'Не удалось отправить заявку')
  } finally {
    saving.value = false
  }
}

function discard() {
  drafts.clear()
}

onBeforeRouteLeave(
  () => drafts.size === 0 || window.confirm('Есть несохраненные изменения графика. Уйти без них?'),
)
useEventListener(window, 'beforeunload', (e: BeforeUnloadEvent) => {
  if (drafts.size > 0) e.preventDefault()
})

const selectedMasterId = ref<string>('')
// Сотруднику на телефоне сразу открывается его собственный календарь. Мастера и
// привязка грузятся разными запросами в любом порядке, поэтому на своего мастера
// переключаем один раз, когда известны оба, — дальше выбор за пользователем.
// Ручной выбор тоже считается: пришедшая позже привязка его не перебьет.
let ownPicked = false
function onMasterPicked() {
  ownPicked = true
}
watch(
  [masters, ownMasterId],
  ([list, own]) => {
    if (!ownPicked && own !== null && list.some((m) => m.id === own)) {
      ownPicked = true
      selectedMasterId.value = String(own)
      return
    }
    if (!list.some((m) => String(m.id) === selectedMasterId.value)) {
      selectedMasterId.value = list[0] ? String(list[0].id) : ''
    }
  },
  { immediate: true },
)
const selectedMaster = computed(() =>
  masters.value.find((m) => String(m.id) === selectedMasterId.value),
)

// На телефоне нажатие на день у того, кто может его отмечать, переключает рабочий
// день, поэтому записи дня смотрят в отдельном режиме. Остальным отмечать нечего,
// и нажатие сразу показывает записи.
type MobileMode = 'mark' | 'bookings'
// Сначала просмотр: случайное нажатие не должно менять график.
const mobileMode = ref<MobileMode>('bookings')
const viewingBookings = computed(
  () =>
    !selectedMaster.value || !canToggle(selectedMaster.value.id) || mobileMode.value === 'bookings',
)

function onModeChange(value: unknown) {
  // Повторное нажатие на выбранный пункт ToggleGroup снимает выбор — режим остается.
  if (value === 'mark' || value === 'bookings') mobileMode.value = value
}

const pickedDay = ref<string | null>(null)
// Выбор из другого месяца не переносится: тогда показываем сегодня или первое число.
const shownDay = computed(() => {
  const picked = pickedDay.value
  if (picked && days.value.some((d) => d.iso === picked)) return picked
  return days.value.find((d) => d.today)?.iso ?? days.value[0]?.iso ?? null
})

const bookingsReady = computed(
  () => bookingsData.value?.ok === true && bookingsData.value.from === range.value.from,
)

const shownDayBookings = computed(() => {
  const m = selectedMaster.value
  const iso = shownDay.value
  if (!m || !iso) return []
  return bookingsByCell.value.get(`${m.id}|${iso}`) ?? []
})

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
  <div class="p-2 text-foreground sm:p-8">
    <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold">График</h1>
        <p
          v-if="studioHoursLines"
          class="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Clock class="mt-0.5 size-3.5 shrink-0" />
          <span>
            Студия:
            <template v-for="(line, i) in studioHoursLines" :key="line">
              <span class="whitespace-nowrap">{{ line }}</span
              ><template v-if="i < studioHoursLines.length - 1">, </template>
            </template>
          </span>
        </p>
      </div>
      <div v-if="canEdit" class="flex shrink-0 flex-wrap gap-2">
        <template v-if="studioDays !== null">
          <Button variant="outline" size="sm" class="h-9" @click="studioHoursOpen = true">
            <Clock class="size-4" />
            Режим работы
          </Button>
          <StudioHoursDialog v-model:open="studioHoursOpen" :days="studioDays" />
        </template>
        <Button variant="outline" size="sm" class="h-9" @click="closedDaysOpen = true">
          <CalendarPlus class="size-4" />
          Добавить выходные
        </Button>
        <ClosedDaysDialog v-model:open="closedDaysOpen" :today="todayIso" />
      </div>
    </header>

    <ScheduleRequestsPanel v-if="canEdit" />
    <MyScheduleRequestCard v-else-if="myRequests" :requests="myRequests.requests" />

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
        <Select v-model="selectedMasterId" @update:model-value="onMasterPicked">
          <SelectTrigger size="sm" class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="m in masters" :key="m.id" :value="String(m.id)">
              {{ isOwn(m.id) ? `${m.name} (вы)` : m.name }}
            </SelectItem>
          </SelectContent>
        </Select>
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
              :title="d.closed ? 'Студия закрыта' : undefined"
            >
              <div
                class="text-xs"
                :class="d.weekend ? 'text-destructive/80' : 'text-muted-foreground'"
              >
                {{ WEEKDAY_SHORT[d.weekday] }}
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
            <!-- Свой мастер отмечен полосой, жирным именем и бейджем, без фона: фон делал строку похожей на
                 неактивную. Полоса — псевдоэлемент, потому что при border-collapse рамка
                 закрепленной ячейки не рисуется. Фон непрозрачный, иначе под ячейкой
                 просвечивали бы дни при прокрутке. -->
            <td
              class="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium"
              :class="
                isOwn(m.id)
                  ? 'font-semibold before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary'
                  : ''
              "
            >
              <span class="flex items-center gap-2">
                <span>{{ m.name }}</span>
                <Badge v-if="isOwn(m.id)">Вы</Badge>
              </span>
            </td>
            <td v-for="d in days" :key="d.iso" class="p-0.5" :class="{ 'bg-muted/60': d.weekend }">
              <button
                v-if="canToggle(m.id)"
                type="button"
                class="flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed"
                :class="[
                  cellClass(m.id, d.iso, 'hover:bg-primary/85', d.closed),
                  { 'hover:bg-accent': !isWorking(m.id, d.iso) && !isLocked(m.id, d.iso) },
                ]"
                :aria-pressed="isWorking(m.id, d.iso)"
                :disabled="isLocked(m.id, d.iso)"
                :title="bookingsTitle(m.id, d.iso)"
                :aria-label="`${m.name}, ${dayLabel(d.iso)}${d.closed ? STUDIO_CLOSED_SUFFIX : ''}${bookingsLabel(m.id, d.iso)}`"
                @click="toggle(m.id, d.iso)"
              >
                <BookingMark
                  v-if="bookingCount(m.id, d.iso) > 0"
                  :count="bookingCount(m.id, d.iso)"
                  :working="isWorking(m.id, d.iso)"
                />
              </button>
              <div
                v-else
                role="img"
                class="flex size-9 items-center justify-center rounded-md border"
                :class="cellClass(m.id, d.iso, '', d.closed)"
                :title="bookingsTitle(m.id, d.iso)"
                :aria-label="`${m.name}, ${dayLabel(d.iso)}: ${isWorking(m.id, d.iso) ? 'рабочий' : 'выходной'}${d.closed ? STUDIO_CLOSED_SUFFIX : ''}${bookingsLabel(m.id, d.iso)}`"
              >
                <BookingMark
                  v-if="bookingCount(m.id, d.iso) > 0"
                  :count="bookingCount(m.id, d.iso)"
                  :working="isWorking(m.id, d.iso)"
                />
              </div>
            </td>
            <td class="px-3 text-right">
              <span class="flex items-center justify-end gap-2">
                <!-- Место под две цифры занято заранее, иначе колонка расширялась бы,
                     когда у кого-то набирается 10 и больше дней. -->
                <span class="min-w-5 text-right tabular-nums">{{ workingCount(m.id) }}</span>
                <Button
                  v-if="canToggle(m.id)"
                  variant="ghost"
                  size="icon"
                  class="size-7 text-muted-foreground"
                  :disabled="saving || !dataReady"
                  :title="isMonthFull(m.id) ? 'Снять все дни' : 'Отметить весь месяц'"
                  :aria-label="`${m.name}: ${isMonthFull(m.id) ? 'снять весь месяц' : 'отметить весь месяц'}`"
                  @click="toggleMonth(m.id)"
                >
                  <CalendarX v-if="isMonthFull(m.id)" class="size-4" />
                  <CalendarCheck v-else class="size-4" />
                </Button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Телефон: месяц одного мастера календарем, ячейки под палец. -->
    <div v-else-if="selectedMaster" class="rounded-md border border-border p-3">
      <div v-if="canToggle(selectedMaster.id)" class="mb-3">
        <!-- Залитый сегмент перекликается с залитыми рабочими днями: в каком режиме
             нажатие меняет график, должно быть видно сразу. -->
        <ToggleGroup
          type="single"
          variant="outline"
          class="w-full"
          aria-label="Что делает нажатие на день"
          :model-value="mobileMode"
          @update:model-value="onModeChange"
        >
          <ToggleGroupItem
            value="bookings"
            class="h-11 flex-1 text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            <ClipboardList class="size-4" aria-hidden="true" />
            Смотреть записи
          </ToggleGroupItem>
          <ToggleGroupItem
            value="mark"
            class="h-11 flex-1 text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            <CalendarCheck class="size-4" aria-hidden="true" />
            Править график
          </ToggleGroupItem>
        </ToggleGroup>
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
        <div v-for="n in leadingBlanks" :key="`blank-${n}`" />
        <template v-for="d in days" :key="d.iso">
          <button
            v-if="!viewingBookings"
            type="button"
            class="flex h-11 flex-col items-center justify-center rounded-md border text-sm leading-none tabular-nums transition-colors disabled:cursor-not-allowed"
            :class="[
              cellClass(selectedMaster.id, d.iso, 'text-primary-foreground', d.closed),
              { 'ring-2 ring-foreground ring-offset-1': d.today },
            ]"
            :aria-pressed="isWorking(selectedMaster.id, d.iso)"
            :disabled="isLocked(selectedMaster.id, d.iso)"
            :title="bookingsTitle(selectedMaster.id, d.iso)"
            :aria-label="`${dayLabel(d.iso)}: ${isWorking(selectedMaster.id, d.iso) ? 'рабочий' : 'выходной'}${d.closed ? STUDIO_CLOSED_SUFFIX : ''}${bookingsLabel(selectedMaster.id, d.iso)}`"
            @click="toggle(selectedMaster.id, d.iso)"
          >
            {{ d.day }}
            <BookingMark
              v-if="bookingCount(selectedMaster.id, d.iso) > 0"
              class="mt-1"
              :count="bookingCount(selectedMaster.id, d.iso)"
              :working="isWorking(selectedMaster.id, d.iso)"
            />
          </button>
          <!-- Выбранный день — кольцо с отступом побольше, чем у сегодняшнего. -->
          <button
            v-else
            type="button"
            class="flex h-11 flex-col items-center justify-center rounded-md border text-sm leading-none tabular-nums transition-colors"
            :class="[
              cellClass(selectedMaster.id, d.iso, 'text-primary-foreground', d.closed),
              d.iso === shownDay
                ? 'ring-2 ring-foreground ring-offset-2'
                : { 'ring-1 ring-foreground ring-offset-1': d.today },
            ]"
            :aria-pressed="d.iso === shownDay"
            :aria-label="`${dayLabel(d.iso)}: ${isWorking(selectedMaster.id, d.iso) ? 'рабочий' : 'выходной'}${d.closed ? STUDIO_CLOSED_SUFFIX : ''}${bookingsLabel(selectedMaster.id, d.iso)}`"
            @click="pickedDay = d.iso"
          >
            {{ d.day }}
            <BookingMark
              v-if="bookingCount(selectedMaster.id, d.iso) > 0"
              class="mt-1"
              :count="bookingCount(selectedMaster.id, d.iso)"
              :working="isWorking(selectedMaster.id, d.iso)"
            />
          </button>
        </template>
      </div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          Рабочих дней: <span class="tabular-nums">{{ workingCount(selectedMaster.id) }}</span>
        </p>
        <Button
          v-if="!viewingBookings"
          variant="outline"
          size="sm"
          class="h-10 shrink-0"
          :disabled="saving || !dataReady"
          @click="toggleMonth(selectedMaster.id)"
        >
          <CalendarX v-if="isMonthFull(selectedMaster.id)" class="size-4" />
          <CalendarCheck v-else class="size-4" />
          {{ isMonthFull(selectedMaster.id) ? 'Снять все' : 'Весь месяц' }}
        </Button>
      </div>
      <section
        v-if="viewingBookings && shownDay"
        class="mt-3 border-t border-border pt-3"
        :aria-label="`Записи на ${dayLabel(shownDay)}`"
      >
        <!-- Вслух при смене дня читается только заголовок, а не все карточки. -->
        <h2 class="text-base font-semibold" aria-live="polite">
          {{ dayLabel(shownDay)
          }}<span class="font-normal text-muted-foreground">, {{ weekdayName(shownDay) }}</span>
        </h2>
        <p
          v-if="hasConflict(selectedMaster.id, shownDay)"
          class="mt-2 flex items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-sm text-destructive"
        >
          <TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
          Мастер в этот день выходной
        </p>
        <p v-if="!bookingsReady" class="py-4 text-center text-sm text-muted-foreground">
          {{ bookingsError ? 'Не удалось загрузить записи' : 'Загрузка записей…' }}
        </p>
        <p
          v-else-if="shownDayBookings.length === 0"
          class="py-4 text-center text-sm text-muted-foreground"
        >
          Записей нет
        </p>
        <ul v-else class="mt-2 flex flex-col gap-2">
          <li
            v-for="b in shownDayBookings"
            :key="b.id"
            class="flex gap-3 rounded-md border border-border p-3 text-sm"
          >
            <!-- Колонка времени, как в календаре: по ней глаз проходит список. -->
            <div class="w-12 shrink-0 tabular-nums">
              <div class="text-base font-semibold">{{ b.timeFrom }}</div>
              <div v-if="b.timeTo" class="text-xs text-muted-foreground">до {{ b.timeTo }}</div>
            </div>
            <div class="min-w-0">
              <div class="font-medium">{{ b.car }}</div>
              <div class="whitespace-pre-line text-muted-foreground">{{ b.service }}</div>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <div
      v-if="!error && !showSkeleton && masters.length > 0"
      class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      <span class="flex items-center gap-1.5">
        <span class="size-3 rounded-sm bg-primary" /> Рабочий
      </span>
      <span class="flex items-center gap-1.5">
        <span class="size-3 rounded-sm border border-border" /> Выходной
      </span>
      <span v-if="hasClosedDays" class="flex items-center gap-1.5">
        <span class="closed-hatch size-3 rounded-sm border border-border" /> Студия закрыта
      </span>
      <span v-if="hasVisibleBookings" class="flex items-center gap-1.5">
        <span class="flex items-center gap-0.5 font-medium text-foreground tabular-nums">
          <span class="size-1.5 rounded-full bg-current" />2
        </span>
        Записей в день
      </span>
      <span v-if="hasConflicts" class="flex items-center gap-1.5">
        <span class="size-3 rounded-sm border border-destructive" /> Запись в выходной
      </span>
      <span v-if="canEdit || ownMasterId !== null" class="flex items-center gap-1.5">
        <span class="flex gap-0.5">
          <span class="size-3 rounded-sm border border-primary bg-primary/50" />
          <span class="size-3 rounded-sm border border-dashed border-primary" />
        </span>
        {{ canEdit ? 'Не сохранено' : 'Не согласовано' }}
      </span>
    </div>

    <div
      v-if="dirtyCount > 0"
      class="sticky bottom-2 z-20 mt-4 flex flex-col gap-3 rounded-md border border-border bg-background p-3 shadow-md sm:flex-row sm:items-center sm:justify-between"
    >
      <span class="text-sm font-medium">
        {{ canEdit ? 'Несохраненных изменений' : 'Изменений в заявке' }}:
        <span class="tabular-nums">{{ dirtyCount }}</span>
      </span>
      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-10 flex-1 sm:h-8 sm:flex-none"
          :disabled="saving"
          @click="discard"
        >
          Отменить
        </Button>
        <Button size="sm" class="h-10 flex-1 sm:h-8 sm:flex-none" :disabled="saving" @click="save">
          <template v-if="canEdit">{{ saving ? 'Сохранение…' : 'Сохранить' }}</template>
          <template v-else>{{ saving ? 'Отправка…' : 'Отправить на согласование' }}</template>
        </Button>
      </div>
    </div>
  </div>
</template>
