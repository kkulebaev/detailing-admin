<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, provide } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { z } from 'zod'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { v4 as uuid } from 'uuid'
import { toast } from 'vue-sonner'
import { Calendar as CalendarIcon, Pencil } from '@lucide/vue'
import { today, getLocalTimeZone, CalendarDate } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import {
  bookingSchema,
  DEFAULT_CAR_CLASS,
} from '@detailing-admin/shared'
import type { BookingApiResult, CarClass } from '@detailing-admin/shared'
import { submitBooking } from '@/lib/api'
import { usePricelistQuery, useMastersQuery } from '@/lib/queries'
import { resolveMasterOptions } from '@/lib/master-options'
import { CAR_SUGGESTIONS } from '@/lib/car-suggestions'
import { maskThousands } from '@/lib/number-mask'
import { formatServiceCell, formatAmountFormula, type ServiceBreakdownRow } from '@/lib/service-breakdown'
import { usePhoneInput, formatPastedPhone } from '@/composables/use-phone-input'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Calendar } from '@/components/ui/calendar'
import ServicePicker from './ServicePicker.vue'
import {
  Popover,
  PopoverAnchor,
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
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { FORM_SHOW_ERRORS_KEY } from '@/components/ui/form/injectionKeys'

// Form field set used to narrow Zod issue paths into a literal union without a
// type assertion. `Record<BookingField, true>` lets us use `in` for narrowing.
type BookingField =
  | 'dateFrom'
  | 'dateTo'
  | 'time'
  | 'timeTo'
  | 'name'
  | 'phone'
  | 'car'
  | 'service'
  | 'note'
  | 'amount'
  | 'master'
  | 'responsible'
  | 'carClass'
const BOOKING_FIELDS: Record<BookingField, true> = {
  dateFrom: true,
  dateTo: true,
  time: true,
  timeTo: true,
  name: true,
  phone: true,
  car: true,
  service: true,
  note: true,
  amount: true,
  master: true,
  responsible: true,
  carClass: true,
}
function isBookingField(s: string): s is BookingField {
  return s in BOOKING_FIELDS
}

// Master/responsible dropdowns are driven by the live `masters` table but must
// never leave the booking flow dependent on Postgres — `resolveMasterOptions`
// falls back to the hard-coded enum when the list is missing or empty.
const { data: mastersData, asyncStatus: mastersStatus } = useMastersQuery()
const mastersForMaster = computed(() =>
  resolveMasterOptions(mastersData.value?.ok ? mastersData.value.masters : undefined, () => true),
)
const mastersForResponsible = computed(() =>
  resolveMasterOptions(mastersData.value?.ok ? mastersData.value.masters : undefined, (m) => m.canBeResponsible),
)
const mastersLoading = computed(() => mastersStatus.value === 'loading' && mastersData.value === undefined)
// Without the enum fallback, an unloaded or empty list leaves the master select
// empty — warn explicitly so the form doesn't look silently broken.
const mastersWarning = computed(() => {
  if (mastersLoading.value || mastersForMaster.value.length > 0) return null
  return mastersData.value?.ok
    ? 'Список мастеров пуст. Добавьте мастеров на странице «Мастера».'
    : 'Список мастеров недоступен. Обновите страницу.'
})

// The «Отправить уведомление» toggle is only meaningful for a master who has a
// Telegram ID on record. Names are unique in the masters table, so matching the
// selected name against the live list is safe; when the list can't load there is
// no telegramId to check, so notifications stay unavailable.
const selectedMaster = computed(() => {
  const list = mastersData.value?.ok ? mastersData.value.masters : undefined
  if (!list || !values.master) return undefined
  return list.find((m) => m.name === values.master)
})
const canNotifyMaster = computed(() => {
  const tg = selectedMaster.value?.telegramId
  return typeof tg === 'string' && tg.trim().length > 0
})
const notifyHint = computed(() =>
  values.master ? 'У мастера не указан Telegram ID' : 'Выберите мастера',
)

// ── Idempotency key: same across retries, regenerated on success ──────────────
const idempotencyKey = ref(uuid())

// Kept in sync with `canNotifyMaster` below: on it defaults to enabled, off it
// is force-disabled. The submit handler passes its value to the backend as
// `notify`, which sends the master a Telegram message best-effort.
const sendNotification = ref(true)

// ── Calendar state ────────────────────────────────────────────────────────────
const localTz = getLocalTimeZone()
const todayVal = today(localTz)
// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it)
const dateFromCal = shallowRef<DateValue>(todayVal)
const dateToCal = shallowRef<DateValue>(todayVal)

// Range mode (replaces the old Switch). When on, the second row
// «Окончание работ» appears with its own date + time inputs.
const isRangeMode = ref(false)

const dateFromOpen = ref(false)
const dateToOpen = ref(false)

function calToString(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

// Date/time live in their own refs so the user can type directly into masked
// text inputs. The calendar popover is just an alternative input that writes
// back into these refs.
const dateFromText = ref(calToString(todayVal))
const dateToText = ref(calToString(todayVal))
const timeValue = ref('')
const timeToValue = ref('')

// Hide "Invalid" / regex error labels until the user actually tries to submit,
// otherwise an empty initial form flashes red on mount.
const submitAttempted = ref(false)
provide(FORM_SHOW_ERRORS_KEY, submitAttempted)

function maskDateText(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`
}

function maskTimeText(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

// Russian plate: 1 letter + 3 digits + 2 letters + 2–3 digits (region).
// Only letters shared with Latin glyphs are legal; Latin look-alikes are
// transliterated so a keyboard layout slip doesn't block typing.
const PLATE_LETTERS = new Set(['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'])
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н',
  O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
}

function capitalizeWords(raw: string): string {
  return raw.replace(/(^|[\s\-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('ru'))
}

function maskName(raw: string): string {
  return capitalizeWords(raw.replace(/\d/g, ''))
}

function maskCar(raw: string): string {
  return capitalizeWords(raw)
}

function maskLicensePlate(raw: string): string {
  let out = ''
  for (const ch of raw.toUpperCase()) {
    if (out.length >= 9) break
    const c = LATIN_TO_CYRILLIC[ch] ?? ch
    const pos = out.length
    const expectsLetter = pos === 0 || pos === 4 || pos === 5
    if (expectsLetter) {
      if (PLATE_LETTERS.has(c)) out += c
    } else if (/\d/.test(c)) {
      out += c
    }
  }
  return out
}

function parseDateText(text: string): DateValue | null {
  const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) return null
  try {
    return new CalendarDate(year, month, day)
  } catch {
    return null
  }
}

function sameDay(a: DateValue | undefined, b: DateValue | undefined): boolean {
  if (!a || !b) return false
  return a.year === b.year && a.month === b.month && a.day === b.day
}

// ── Unavailable banner (non-dismissable) ─────────────────────────────────────
type UnavailableBanner =
  | {
      kind: 'headers_mismatch'
      column_index: number
      expected: string
      observed: string
    }
  | { kind: 'not_configured'; message: string }
const unavailableBanner = ref<UnavailableBanner | null>(null)

// ── Phone input (raw display value + handlers) ──────────────────────────────
// Starts empty so the placeholder is visible; typing '+', '7' or '8' as the
// first character auto-expands to the +7 prefix.
const {
  phoneRaw,
  effectivePhone,
  onPhoneInput,
  onPhoneKeydown,
  onPhonePaste,
  onClickPastePhone,
  resetPhone,
} = usePhoneInput()
// ── License plate (UI-only, concatenated into `car` on submit) ───────────────
const licensePlate = ref('')
// ── Amount display value (formatted with thousand separators) ────────────────
const amountRaw = ref('')

// Latest sum of the picker's per-service prices (null when nothing selected).
// Kept so «Сумма» can flag when it was hand-edited away from this total.
const servicesTotal = ref<number | null>(null)

// Latest per-service breakdown from the picker — projected into the sheet's
// «Услуга» cell at submit time (the form field itself stays a plain name CSV).
const serviceBreakdown = ref<ServiceBreakdownRow[]>([])

function formatAmount(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function amountDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

// Signed difference between «Сумма» and the services total (current − total).
// null when there's no total to compare against. Empty amount counts as 0.
const amountDelta = computed<number | null>(() => {
  if (servicesTotal.value === null) return null
  const digits = amountDigits(amountRaw.value)
  const current = digits === '' ? 0 : parseInt(digits, 10)
  return current - servicesTotal.value
})

// True when services are selected and «Сумма» no longer equals their total —
// i.e. the operator typed an override (or used a +preset).
const amountOverridden = computed(() => amountDelta.value !== null && amountDelta.value !== 0)

// «+2 500 ₽» / «−2 000 ₽» — how far the manual amount sits from the services total.
const amountDeltaLabel = computed(() => {
  const d = amountDelta.value ?? 0
  const sign = d > 0 ? '+' : '−'
  return `${sign}${formatAmount(String(Math.abs(d)))} ₽`
})

function resetAmountToServices() {
  if (servicesTotal.value === null) return
  amountRaw.value = formatAmount(String(servicesTotal.value))
  setFieldValue('amount', servicesTotal.value)
}

// ── Discount (₽ or %) ─────────────────────────────────────────────────────────
// UI-only helper applied to «Сумма» (the base) to produce «Итого к оплате». On
// submit the discounted total is what's saved to the sheet's amount column, and
// a «Скидка …» line is appended to the note — there's no discount column.
const discountRaw = ref('')
const discountUnit = ref<'rub' | 'pct'>('rub')

const baseAmount = computed(() => {
  const digits = amountDigits(amountRaw.value)
  return digits === '' ? 0 : parseInt(digits, 10)
})

// Discount in rubles, clamped so it never exceeds the base (% capped at 100).
// Percentage is rounded to the nearest ruble.
const discountAmount = computed(() => {
  const digits = discountRaw.value.replace(/\D/g, '')
  if (digits === '') return 0
  const n = parseInt(digits, 10)
  if (discountUnit.value === 'pct') {
    return Math.round((baseAmount.value * Math.min(n, 100)) / 100)
  }
  return Math.min(n, baseAmount.value)
})

const finalAmount = computed(() => Math.max(0, baseAmount.value - discountAmount.value))
const hasDiscount = computed(() => discountAmount.value > 0)

function onDiscountInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (discountUnit.value === 'pct') {
    let digits = target.value.replace(/\D/g, '').slice(0, 3)
    if (digits !== '' && parseInt(digits, 10) > 100) digits = '100'
    if (target.value !== digits) {
      target.value = digits
      target.setSelectionRange(digits.length, digits.length)
    }
    discountRaw.value = digits
    return
  }
  const caretPos = target.selectionStart ?? target.value.length
  const { value, caret } = maskThousands(target.value, caretPos, 8)
  if (target.value !== value) {
    target.value = value
    target.setSelectionRange(caret, caret)
  }
  discountRaw.value = value
}

// Re-normalise the raw value when switching units: % strips grouping and caps
// at 100; ₽ regroups with thousand separators.
function setDiscountUnit(unit: 'rub' | 'pct') {
  if (unit === discountUnit.value) return
  discountUnit.value = unit
  const digits = discountRaw.value.replace(/\D/g, '')
  if (digits === '') return
  discountRaw.value =
    unit === 'pct' ? String(Math.min(parseInt(digits, 10), 100)) : formatAmount(digits)
}

// «Скидка 10%» / «Скидка 950 ₽» — appended to the note on save. The concrete
// rouble figure derived from a percent discount is intentionally omitted; only
// the discount size itself is kept.
function discountNoteLine(): string {
  if (!hasDiscount.value) return ''
  if (discountUnit.value === 'pct') {
    const pct = Math.min(parseInt(discountRaw.value.replace(/\D/g, '') || '0', 10), 100)
    return `Скидка ${pct}%`
  }
  return `Скидка ${formatAmount(String(discountAmount.value))} ₽`
}

// ── Quick-pick presets ───────────────────────────────────────────────────────
const AMOUNT_PRESETS = [1000, 5000, 10000, 50000] as const

// Working hours of the detailing shop: 10:00–18:30 in 30-minute slots.
const TIME_PRESETS = [
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
] as const

// ── Form ──────────────────────────────────────────────────────────────────────
// Optional string-or-undefined fields need the type widened from the literal
// `undefined` so vee-validate accepts later `setFieldValue('dateTo', '04.06.2026')`
// calls. Same for `amount`, which transitions from `''` to a parsed number.
interface BookingFormInitial {
  dateFrom: string
  dateTo: string | undefined
  time: string
  timeTo: string | undefined
  name: string
  phone: string
  car: string
  service: string
  note: string
  amount: '' | number
  master: string | undefined
  responsible: string | undefined
  carClass: CarClass
}

const initialFormValues: BookingFormInitial = {
  dateFrom: calToString(todayVal),
  dateTo: undefined,
  time: '',
  timeTo: undefined,
  name: '',
  phone: '',
  car: '',
  service: '',
  note: '',
  amount: '',
  master: undefined,
  responsible: undefined,
  carClass: DEFAULT_CAR_CLASS,
}

const {
  handleSubmit,
  setFieldValue,
  setFieldError,
  resetForm,
  validate,
  values,
  errors,
  isSubmitting,
} = useForm({
  validationSchema: toTypedSchema(bookingSchema),
  initialValues: initialFormValues,
})

// Keep the notification toggle in sync with availability: off when the selected
// master has no Telegram ID, on once a notifiable master is picked. Declared
// after useForm so the immediate run can read `values` (avoids a TDZ error).
watch(canNotifyMaster, (ok) => {
  sendNotification.value = ok
}, { immediate: true })

// The phone input is bound to the raw string and lives outside a FormField (see
// F7), so vee-validate never observes keystrokes and its «Укажите номер
// телефона» error lingered after a failed submit. Mirror the effective value
// into the form field on every change (setFieldValue validates by default) so
// the error clears live once a number is entered.
watch(phoneRaw, () => {
  setFieldValue('phone', effectivePhone())
})

// ── Quick date chips ─────────────────────────────────────────────────────────
function shiftedDate(days: number): DateValue {
  return todayVal.add({ days })
}

function pickDay(days: number) {
  const d = shiftedDate(days)
  isRangeMode.value = false
  dateFromCal.value = d
  dateFromText.value = calToString(d)
  setFieldValue('dateFrom', calToString(d))
  setFieldValue('dateTo', undefined)
  setFieldValue('timeTo', undefined)
  timeToValue.value = ''
}

function toggleRangeMode() {
  if (isRangeMode.value) {
    isRangeMode.value = false
    setFieldValue('dateTo', undefined)
    setFieldValue('timeTo', undefined)
    timeToValue.value = ''
    return
  }
  isRangeMode.value = true
  // Mirror dateFrom into dateTo so the user can adjust just the end, and a
  // half-filled range never lands in the form fields.
  dateToCal.value = dateFromCal.value
  dateToText.value = dateFromText.value
  setFieldValue('dateTo', dateFromText.value)
}

const isTodayActive = computed(() => !isRangeMode.value && sameDay(dateFromCal.value, shiftedDate(0)))
const isTomorrowActive = computed(() => !isRangeMode.value && sameDay(dateFromCal.value, shiftedDate(1)))
const isDayAfter2Active = computed(() => !isRangeMode.value && sameDay(dateFromCal.value, shiftedDate(2)))

function pickTime(t: string) {
  timeValue.value = t
  setFieldValue('time', t)
}

function pickTimeTo(t: string) {
  timeToValue.value = t
  setFieldValue('timeTo', t)
}

// ── Car suggestions (autocomplete combobox) ──────────────────────────────────
const carPopoverOpen = ref(false)
const carActiveIndex = ref(0)
const carListEl = ref<HTMLElement | null>(null)
const MAX_CAR_SUGGESTIONS = 30
const filteredCars = computed<readonly string[]>(() => {
  const q = (values.car ?? '').trim().toLowerCase()
  if (!q) return CAR_SUGGESTIONS.slice(0, MAX_CAR_SUGGESTIONS)
  return CAR_SUGGESTIONS
    .filter((c) => c.toLowerCase().includes(q))
    .slice(0, MAX_CAR_SUGGESTIONS)
})
watch(filteredCars, () => { carActiveIndex.value = 0 })

function selectCar(car: string) {
  setFieldValue('car', car)
  carPopoverOpen.value = false
}

function scrollActiveCarIntoView() {
  requestAnimationFrame(() => {
    const el = carListEl.value?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onCarKeydown(e: KeyboardEvent) {
  const list = filteredCars.value
  if (e.key === 'ArrowDown') {
    if (!carPopoverOpen.value && list.length) carPopoverOpen.value = true
    if (!list.length) return
    e.preventDefault()
    carActiveIndex.value = (carActiveIndex.value + 1) % list.length
    scrollActiveCarIntoView()
  } else if (e.key === 'ArrowUp') {
    if (!list.length) return
    e.preventDefault()
    carActiveIndex.value = (carActiveIndex.value - 1 + list.length) % list.length
    scrollActiveCarIntoView()
  } else if (e.key === 'Enter') {
    if (!carPopoverOpen.value || !list.length) return
    e.preventDefault()
    const picked = list[carActiveIndex.value]
    if (picked) selectCar(picked)
  } else if (e.key === 'Escape') {
    if (!carPopoverOpen.value) return
    e.preventDefault()
    carPopoverOpen.value = false
  }
}

// ── Date / time text input handlers ──────────────────────────────────────────
function onDateFromTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskDateText(target.value)
  if (target.value !== masked) {
    dateFromText.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('dateFrom', masked)
  const parsed = parseDateText(masked)
  if (parsed) dateFromCal.value = parsed
}

function onDateToTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskDateText(target.value)
  if (target.value !== masked) {
    dateToText.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('dateTo', masked)
  const parsed = parseDateText(masked)
  if (parsed) dateToCal.value = parsed
}

function onTimeTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  if (target.value !== masked) {
    timeValue.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('time', masked)
}

function onTimeToTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  if (target.value !== masked) {
    timeToValue.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('timeTo', masked)
}

function onNameInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskName(target.value)
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('name', masked)
}

function onCarInput(e: Event) {
  carPopoverOpen.value = true
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskCar(target.value)
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('car', masked)
}

function onLicensePlateInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskLicensePlate(target.value)
  if (target.value !== masked) {
    licensePlate.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
}

// ── Amount input handler ──────────────────────────────────────────────────────
function onAmountInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const caretPos = target.selectionStart ?? target.value.length
  const { value, caret } = maskThousands(target.value, caretPos)
  if (target.value !== value) {
    amountRaw.value = value
    target.value = value
    target.setSelectionRange(caret, caret)
  }
  const digits = amountDigits(value)
  const parsed: '' | number = digits === '' ? '' : parseInt(digits, 10)
  setFieldValue('amount', parsed)
}

function addAmount(delta: number) {
  const current = parseInt(amountDigits(amountRaw.value), 10) || 0
  const next = current + delta
  amountRaw.value = formatAmount(String(next))
  setFieldValue('amount', next)
}

// Auto-fill «Сумма» from the picker's per-service prices. The field stays
// editable — a manual value simply holds until the next selection/price
// change recomputes the total.
function onServicesTotal(total: number | null) {
  servicesTotal.value = total
  if (total === null) {
    amountRaw.value = ''
    setFieldValue('amount', '')
    return
  }
  amountRaw.value = formatAmount(String(total))
  setFieldValue('amount', total)
}

function onServiceBreakdown(rows: ServiceBreakdownRow[]) {
  serviceBreakdown.value = rows
}

// ── Calendar selection handlers ───────────────────────────────────────────────
function onDateFromSelect(date: DateValue | undefined) {
  if (!date) return
  dateFromCal.value = date
  const str = calToString(date)
  dateFromText.value = str
  setFieldValue('dateFrom', str)
  dateFromOpen.value = false
}

function onDateToSelect(date: DateValue | undefined) {
  if (!date) return
  dateToCal.value = date
  const str = calToString(date)
  dateToText.value = str
  setFieldValue('dateTo', str)
  dateToOpen.value = false
}

// ── Submit ────────────────────────────────────────────────────────────────────
const handleValidatedSubmit = handleSubmit(async (values) => {
  unavailableBanner.value = null
  const plate = licensePlate.value.trim()
  const car = [values.car?.trim(), plate].filter(Boolean).join(', ')
  // The toggle is force-disabled when the master has no Telegram ID, so its
  // value is authoritative; the backend re-checks and never trusts it blindly.
  const payload = { ...values, car, notify: sendNotification.value }
  // The «Услуга» cell gets the categorised breakdown (names only); the form
  // field stays a plain name CSV for draft restore.
  if (serviceBreakdown.value.length > 0) {
    payload.service = formatServiceCell(serviceBreakdown.value)
    // «Сумма» carries the arithmetic behind the total. `values.amount` is the
    // pre-discount base; the formula subtracts the discount itself.
    const base = typeof values.amount === 'number' ? values.amount : 0
    payload.amountFormula = formatAmountFormula(serviceBreakdown.value, base, discountAmount.value)
  }
  // Discount is applied at submit time: the sheet stores the discounted total
  // and the discount is preserved as a note line (no dedicated column).
  if (hasDiscount.value) {
    payload.amount = finalAmount.value
    payload.note = [values.note?.trim(), discountNoteLine()].filter(Boolean).join('\n')
  }
  let result: BookingApiResult
  try {
    result = await submitBooking(payload, idempotencyKey.value)
  } catch {
    const retry = () => { void onSubmit() }
    toast.error('Ошибка при сохранении', {
      action: { label: 'Повторить', onClick: retry },
    })
    return
  }

  if (result.ok) {
    if (result.notification?.attempted && !result.notification.delivered) {
      toast.warning('Запись сохранена, но уведомление мастеру не отправлено')
    } else {
      toast.success('Запись сохранена')
    }
    idempotencyKey.value = uuid()
    resetFormState()
    clearDraft()
  } else if (result.error === 'unavailable' && result.reason === 'headers_mismatch') {
    unavailableBanner.value = {
      kind: 'headers_mismatch',
      column_index: result.column_index ?? 0,
      expected: result.expected ?? '',
      observed: result.observed ?? '',
    }
  } else if (result.error === 'unavailable' && result.reason === 'not_configured') {
    unavailableBanner.value = {
      kind: 'not_configured',
      message: result.message ?? '',
    }
  } else if (result.error === 'validation') {
    for (const issue of result.issues) {
      const field = issue.path[0]
      if (typeof field === 'string' && isBookingField(field)) {
        setFieldError(field, issue.message)
      }
    }
  } else {
    const retry = () => { void onSubmit() }
    toast.error('Ошибка при сохранении', {
      action: { label: 'Повторить', onClick: retry },
    })
  }
})

async function onSubmit() {
  submitAttempted.value = true
  setFieldValue('phone', effectivePhone())
  // Surface errors for all fields up front — handleSubmit alone does not
  // propagate schema errors to registered FormFields that were never touched.
  await validate()
  await handleValidatedSubmit()
}

// Shared reset for both the clear-button and post-submit flows.
function resetFormState() {
  const fresh = today(localTz)
  resetForm({
    values: {
      dateFrom: calToString(fresh),
      dateTo: undefined,
      time: '',
      timeTo: undefined,
      name: '',
      phone: '',
      car: '',
      service: '',
      note: '',
      amount: '',
      master: undefined,
      responsible: undefined,
      carClass: DEFAULT_CAR_CLASS,
    },
  })
  resetPhone()
  licensePlate.value = ''
  amountRaw.value = ''
  servicesTotal.value = null
  serviceBreakdown.value = []
  discountRaw.value = ''
  discountUnit.value = 'rub'
  timeValue.value = ''
  timeToValue.value = ''
  dateFromText.value = calToString(fresh)
  dateToText.value = calToString(fresh)
  dateFromCal.value = fresh
  dateToCal.value = fresh
  isRangeMode.value = false
  sendNotification.value = false
  submitAttempted.value = false
}

function clearForm() {
  resetFormState()
  idempotencyKey.value = uuid()
  unavailableBanner.value = null
  clearDraft()
}

// ── Draft persistence (localStorage) ─────────────────────────────────────────
// v5: service field moved from free text to picker (selection restored from CSV
// of service names against the loaded pricelist); carClass added.
const DRAFT_KEY = 'detailing-admin:booking-draft:v5'

// Draft schema is permissive on purpose — every field is optional so a
// half-filled or older-version localStorage entry parses without bouncing back.
const draftSchema = z.object({
  dateFromText: z.string().optional(),
  dateToText: z.string().optional(),
  timeValue: z.string().optional(),
  timeToValue: z.string().optional(),
  isRangeMode: z.boolean().optional(),
  name: z.string().optional(),
  phoneRaw: z.string().optional(),
  car: z.string().optional(),
  licensePlate: z.string().optional(),
  service: z.string().optional(),
  note: z.string().optional(),
  amountRaw: z.string().optional(),
  discountRaw: z.string().optional(),
  discountUnit: z.union([z.literal('rub'), z.literal('pct')]).optional(),
  master: z.string().optional(),
  responsible: z.string().optional(),
  carClass: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

type Draft = z.infer<typeof draftSchema>

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* storage may be disabled */ }
}

function saveDraft() {
  try {
    const draft: Draft = {
      dateFromText: dateFromText.value,
      dateToText: dateToText.value,
      timeValue: timeValue.value,
      timeToValue: timeToValue.value,
      isRangeMode: isRangeMode.value,
      name: values.name ?? '',
      phoneRaw: phoneRaw.value,
      car: values.car ?? '',
      licensePlate: licensePlate.value,
      service: values.service ?? '',
      note: values.note ?? '',
      amountRaw: amountRaw.value,
      discountRaw: discountRaw.value,
      discountUnit: discountUnit.value,
      master: values.master,
      responsible: values.responsible,
      carClass: values.carClass,
    }
    const meaningful =
      draft.isRangeMode || draft.timeValue || draft.name || draft.car || draft.licensePlate ||
      draft.service || draft.note || draft.amountRaw || draft.discountRaw || draft.master ||
      draft.responsible || (draft.phoneRaw && draft.phoneRaw.replace(/\D/g, '').length > 1)
    if (!meaningful) { clearDraft(); return }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch { /* ignore */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return
    const parsed = draftSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return
    const d = parsed.data
    if (d.dateFromText) {
      dateFromText.value = d.dateFromText
      const parsed = parseDateText(d.dateFromText)
      if (parsed) dateFromCal.value = parsed
      setFieldValue('dateFrom', d.dateFromText)
    }
    if (d.dateToText) {
      dateToText.value = d.dateToText
      const parsed = parseDateText(d.dateToText)
      if (parsed) dateToCal.value = parsed
    }
    if (d.isRangeMode) {
      isRangeMode.value = true
      setFieldValue('dateTo', d.dateToText)
      if (d.timeToValue) {
        timeToValue.value = d.timeToValue
        setFieldValue('timeTo', d.timeToValue)
      }
    }
    if (d.timeValue) {
      timeValue.value = d.timeValue
      setFieldValue('time', d.timeValue)
    }
    if (d.name) setFieldValue('name', d.name)
    if (d.phoneRaw) phoneRaw.value = d.phoneRaw
    if (d.car) setFieldValue('car', d.car)
    if (d.licensePlate) licensePlate.value = d.licensePlate
    if (d.service) setFieldValue('service', d.service)
    if (d.note) setFieldValue('note', d.note)
    if (d.amountRaw) {
      amountRaw.value = d.amountRaw
      const digits = amountDigits(d.amountRaw)
      if (digits) setFieldValue('amount', parseInt(digits, 10))
    }
    if (d.discountUnit) discountUnit.value = d.discountUnit
    if (d.discountRaw) discountRaw.value = d.discountRaw
    if (d.master && d.master.trim()) setFieldValue('master', d.master)
    if (d.responsible && d.responsible.trim()) setFieldValue('responsible', d.responsible)
    if (d.carClass) setFieldValue('carClass', d.carClass)
  } catch { /* corrupted draft: ignore */ }
}

// ── Тестовое заполнение (Ctrl+Shift+X) ───────────────────────────────────────
// Быстро набивает форму правдоподобными случайными данными для ручного
// тестирования. Услугу берём из уже загруженного прайс-листа — тогда «Сумма»
// пересчитается сама через ServicePicker; иначе выставляем сумму вручную.
const { data: pricelistData } = usePricelistQuery()

const TEST_NAMES = ['Иван Петров', 'Мария Смирнова', 'Алексей Иванов', 'Ольга Кузнецова', 'Дмитрий Соколов']
const TEST_NOTES = ['', 'Тестовая запись', 'Клиент просил перезвонить', 'Оплата картой']
const PLATE_LETTER_LIST = [...PLATE_LETTERS]

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function randomDigits(n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10)
  return out
}

function randomPlate(): string {
  const l = () => pickRandom(PLATE_LETTER_LIST)
  const region = Math.random() < 0.5 ? randomDigits(2) : randomDigits(3)
  return `${l()}${randomDigits(3)}${l()}${l()}${region}`
}

function fillTestData() {
  pickDay(pickRandom([0, 1, 2]))
  pickTime(pickRandom(TIME_PRESETS))

  setFieldValue('name', pickRandom(TEST_NAMES))
  phoneRaw.value = formatPastedPhone(`9${randomDigits(9)}`)
  setFieldValue('car', pickRandom(CAR_SUGGESTIONS))
  licensePlate.value = randomPlate()
  setFieldValue('note', pickRandom(TEST_NOTES))
  setFieldValue('master', pickRandom(mastersForMaster.value))
  setFieldValue('responsible', pickRandom(mastersForResponsible.value))

  const r = pricelistData.value
  const allServices = r?.ok ? r.sections.flatMap((s) => s.services) : []
  if (allServices.length > 0) {
    const svc = pickRandom(allServices)
    // ServicePicker слушает modelValue: подхватит выбор и сам эмитнёт «Сумму».
    setFieldValue('service', svc.name)
  } else {
    const amount = (Math.floor(Math.random() * 40) + 5) * 500
    amountRaw.value = formatAmount(String(amount))
    setFieldValue('amount', amount)
  }

  toast.success('Форма заполнена тестовыми данными')
}

// Инструмент только для локальной отладки — в прод-сборку не попадает.
if (import.meta.env.DEV) {
  onKeyStroke(
    (e) => e.ctrlKey && e.shiftKey && e.code === 'KeyX',
    (e) => {
      e.preventDefault()
      fillTestData()
    },
  )
}

onMounted(loadDraft)

let saveScheduled = false
function scheduleSave() {
  if (saveScheduled) return
  saveScheduled = true
  requestAnimationFrame(() => {
    saveScheduled = false
    saveDraft()
  })
}

watch(
  [
    dateFromText, dateToText, timeValue, timeToValue, isRangeMode,
    phoneRaw, licensePlate, amountRaw, discountRaw, discountUnit,
    () => values.name, () => values.car, () => values.service,
    () => values.note, () => values.master,
    () => values.responsible, () => values.carClass,
  ],
  scheduleSave,
)
</script>

<template>
  <div class="min-h-screen bg-muted/30">
    <!-- Non-dismissable unavailable banner -->
    <div
      v-if="unavailableBanner && unavailableBanner.kind === 'headers_mismatch'"
      class="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium"
      role="alert"
    >
      «Сервис временно недоступен: расхождение в заголовках таблицы.
      Столбец {{ unavailableBanner.column_index + 1 }}: ожидается «{{ unavailableBanner.expected }}», найдено «{{ unavailableBanner.observed }}».
      Исправьте заголовок в таблице или EXPECTED_HEADERS в коде и перезапустите API.»
    </div>
    <div
      v-else-if="unavailableBanner && unavailableBanner.kind === 'not_configured'"
      class="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium"
      role="alert"
    >
      «Сервис не сконфигурирован: {{ unavailableBanner.message }}. Проверьте серверные переменные окружения и перезапустите API.»
    </div>

    <form class="max-w-lg mx-auto px-4 pt-6 pb-36" @submit.prevent="onSubmit">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl font-semibold">Новая запись</h1>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-muted-foreground"
          :disabled="isSubmitting"
          @click="clearForm"
          aria-label="Очистить форму"
        >
          Очистить
        </Button>
      </div>

      <div class="space-y-3">
        <!-- Дата и время записи -->
        <Card class="gap-4 py-4 shadow-none">
          <CardHeader class="px-4">
            <CardTitle class="text-base">Дата и время записи</CardTitle>
          </CardHeader>
          <CardContent class="px-4">
          <!-- Quick date chips -->
          <div class="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              :data-active="isTodayActive"
              class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
              @click="pickDay(0)"
            >
              Сегодня
            </button>
            <button
              type="button"
              :data-active="isTomorrowActive"
              class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
              @click="pickDay(1)"
            >
              Завтра
            </button>
            <button
              type="button"
              :data-active="isDayAfter2Active"
              class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
              @click="pickDay(2)"
            >
              Послезавтра
            </button>
            <button
              type="button"
              :data-active="isRangeMode"
              class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
              @click="toggleRangeMode"
            >
              Диапазон
            </button>
          </div>

          <div class="flex gap-2">
            <!-- Date text input + calendar icon trigger -->
            <div class="relative flex-1">
              <Input
                type="text"
                inputmode="numeric"
                class="h-11 pr-10"
                placeholder="ДД.ММ.ГГГГ"
                v-model="dateFromText"
                :aria-invalid="submitAttempted && !!errors.dateFrom"
                @input="onDateFromTextInput"
              />
              <Popover v-model:open="dateFromOpen">
                <PopoverTrigger as-child>
                  <button
                    type="button"
                    aria-label="Выбрать дату в календаре"
                    class="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                  >
                    <CalendarIcon class="size-4.5" />
                  </button>
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
            <!-- Time text input (masked HH:MM) -->
            <Input
              type="text"
              inputmode="numeric"
              class="h-11 w-24"
              placeholder="ЧЧ:ММ"
              v-model="timeValue"
              :aria-invalid="submitAttempted && !!errors.time"
              @input="onTimeTextInput"
            />
          </div>

          <!-- Time quick chips -->
          <div class="flex flex-wrap gap-1.5 mt-2">
            <button
              v-for="t in TIME_PRESETS"
              :key="t"
              type="button"
              :data-active="timeValue === t"
              class="text-xs px-2.5 py-1 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
              @click="pickTime(t)"
            >
              {{ t }}
            </button>
          </div>

          <p v-if="submitAttempted && errors.time" class="text-sm font-medium text-destructive mt-1">
            {{ errors.time }}
          </p>

          <!-- End of work — smoothly expands/collapses when toggling range mode.
               Outer grid animates grid-template-rows 0fr↔1fr; inner overflow-hidden
               clips during the transition. pt-4 on the innermost wrapper provides
               spacing above the range section when expanded and collapses with the
               row when hidden (preventing a ghost margin).
               NB: 0fr suffix is `!` (Tailwind v4 important) — without it, Tailwind
               emits grid-rows-[1fr] after grid-rows-[0fr] in source order, so the
               baseline class always wins and the transition never sees a change. -->
          <Transition
            enter-active-class="transition-[grid-template-rows] duration-200 ease-out"
            leave-active-class="transition-[grid-template-rows] duration-200 ease-out"
            enter-from-class="grid-rows-[0fr]!"
            leave-to-class="grid-rows-[0fr]!"
          >
            <div v-if="isRangeMode" class="grid grid-rows-[1fr]">
              <div class="overflow-hidden">
                <div class="pt-4">
                  <Label class="mb-2 block">Окончание работ</Label>
                  <div class="flex gap-2">
                    <div class="relative flex-1">
                      <Input
                        type="text"
                        inputmode="numeric"
                        class="h-11 pr-10"
                        placeholder="ДД.ММ.ГГГГ"
                        v-model="dateToText"
                        :aria-invalid="submitAttempted && !!errors.dateTo"
                        @input="onDateToTextInput"
                      />
                      <Popover v-model:open="dateToOpen">
                        <PopoverTrigger as-child>
                          <button
                            type="button"
                            aria-label="Выбрать дату окончания в календаре"
                            class="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                          >
                            <CalendarIcon class="size-4.5" />
                          </button>
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
                    <Input
                      type="text"
                      inputmode="numeric"
                      class="h-11 w-24"
                      placeholder="ЧЧ:ММ"
                      v-model="timeToValue"
                      :aria-invalid="submitAttempted && !!errors.timeTo"
                      @input="onTimeToTextInput"
                    />
                  </div>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <button
                      v-for="t in TIME_PRESETS"
                      :key="t"
                      type="button"
                      :data-active="timeToValue === t"
                      class="text-xs px-2.5 py-1 rounded-full border border-input bg-background hover:bg-accent transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:border-primary"
                      @click="pickTimeTo(t)"
                    >
                      {{ t }}
                    </button>
                  </div>
                  <p v-if="submitAttempted && errors.timeTo" class="text-sm font-medium text-destructive mt-1">
                    {{ errors.timeTo }}
                  </p>
                  <p v-if="submitAttempted && errors.dateTo" class="text-sm font-medium text-destructive mt-1">
                    {{ errors.dateTo }}
                  </p>
                </div>
              </div>
            </div>
          </Transition>
          </CardContent>
        </Card>

        <!-- Информация о клиенте -->
        <Card class="gap-4 py-4 shadow-none">
          <CardHeader class="px-4">
            <CardTitle class="text-base">Информация о клиенте</CardTitle>
          </CardHeader>
          <CardContent class="px-4">
          <div class="space-y-4">
            <FormField v-slot="{ componentField }" name="name">
              <FormItem>
                <FormLabel>Имя</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    class="h-11"
                    placeholder="Иван"
                    v-bind="componentField"
                    @input="onNameInput"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>

            <!-- Phone (bound to raw masked string — outside FormField on purpose, see F7) -->
            <div>
              <Label class="mb-2 block">Номер телефона</Label>
              <div class="relative">
                <Input
                  type="tel"
                  inputmode="tel"
                  class="h-11 pr-24"
                  placeholder="+7 (___) ___-__-__"
                  :model-value="phoneRaw"
                  :aria-invalid="submitAttempted && !!errors.phone"
                  @input="onPhoneInput"
                  @keydown="onPhoneKeydown"
                  @paste="onPhonePaste"
                />
                <button
                  type="button"
                  aria-label="Вставить номер из буфера обмена"
                  class="absolute right-1 top-1/2 -translate-y-1/2 h-9 px-3 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground text-xs font-medium"
                  @click="onClickPastePhone"
                >
                  Вставить
                </button>
              </div>
              <p v-if="submitAttempted && errors.phone" class="text-sm font-medium text-destructive mt-1">
                {{ errors.phone }}
              </p>
            </div>

            <FormField v-slot="{ componentField }" name="car">
              <FormItem>
                <FormLabel>Марка и модель</FormLabel>
                <Popover :open="carPopoverOpen && filteredCars.length > 0">
                  <PopoverAnchor as-child>
                    <FormControl>
                      <Input
                        type="text"
                        class="h-11"
                        placeholder="Toyota Camry"
                        autocomplete="off"
                        v-bind="componentField"
                        @focus="carPopoverOpen = true"
                        @input="onCarInput"
                        @blur="carPopoverOpen = false"
                        @keydown="onCarKeydown"
                      />
                    </FormControl>
                  </PopoverAnchor>
                  <PopoverContent
                    class="w-(--reka-popover-trigger-width) p-0 max-h-72 overflow-auto"
                    align="start"
                    :side-offset="4"
                    @open-auto-focus.prevent
                    @pointer-down-outside.prevent
                  >
                    <ul ref="carListEl" class="py-1">
                      <li v-for="(car, i) in filteredCars" :key="car">
                        <button
                          type="button"
                          :data-active="i === carActiveIndex"
                          class="w-full text-left px-3 py-2 text-sm outline-none data-[active=true]:bg-accent"
                          @mousedown.prevent="selectCar(car)"
                          @mousemove="carActiveIndex = i"
                        >
                          {{ car }}
                        </button>
                      </li>
                    </ul>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            </FormField>

            <div>
              <Label class="mb-2 block">
                Гос. номер
                <span class="text-muted-foreground font-normal">(необязательно)</span>
              </Label>
              <Input
                type="text"
                class="h-11"
                placeholder="А123АА777"
                maxlength="9"
                autocomplete="off"
                autocapitalize="characters"
                v-model="licensePlate"
                @input="onLicensePlateInput"
              />
            </div>
          </div>
          </CardContent>
        </Card>

        <!-- Объем работ -->
        <Card class="gap-4 py-4 shadow-none">
          <CardHeader class="px-4">
            <CardTitle class="text-base">Объем работ</CardTitle>
          </CardHeader>
          <CardContent class="px-4">
          <div class="space-y-4">
            <!-- Bound via explicit props instead of `v-bind="componentField"`:
                 componentField's fallthrough onInput/onChange DOM listeners
                 land on the picker's root div and would overwrite `service`
                 with text from any bubbling event (e.g. the price inputs). -->
            <FormField v-slot="{ value, handleChange }" name="service">
              <FormItem>
                <FormLabel>Услуга</FormLabel>
                <FormControl>
                  <ServicePicker
                    :model-value="typeof value === 'string' ? value : ''"
                    :car-class="values.carClass ?? DEFAULT_CAR_CLASS"
                    :invalid="submitAttempted && !!errors.service"
                    @update:model-value="handleChange"
                    @update:car-class="(c: CarClass) => setFieldValue('carClass', c)"
                    @update:total="onServicesTotal"
                    @update:breakdown="onServiceBreakdown"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>

            <FormField v-slot="{ componentField }" name="note">
              <FormItem>
                <FormLabel>
                  Примечание
                  <span class="text-muted-foreground font-normal">(необязательно)</span>
                </FormLabel>
                <FormControl>
                  <Textarea
                    rows="3"
                    class="[field-sizing:content]"
                    v-bind="componentField"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            </FormField>
          </div>
          </CardContent>
        </Card>

        <!-- Оплата -->
        <Card class="gap-4 py-4 shadow-none">
          <CardHeader class="px-4">
            <CardTitle class="text-base">Оплата</CardTitle>
          </CardHeader>
          <CardContent class="px-4">
          <Label class="mb-2 block">Сумма, ₽</Label>
          <Input
            type="text"
            inputmode="numeric"
            class="h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="0"
            v-model="amountRaw"
            :aria-invalid="submitAttempted && !!errors.amount"
            @input="onAmountInput"
          />
          <div class="flex flex-wrap gap-2 mt-2">
            <button
              v-for="delta in AMOUNT_PRESETS"
              :key="delta"
              type="button"
              class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors"
              @click="addAmount(delta)"
            >
              +{{ formatAmount(String(delta)) }}
            </button>
          </div>
          <p
            v-if="amountOverridden"
            class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-600 dark:text-amber-500"
          >
            <Pencil class="size-3.5 shrink-0" />
            <span>Изменено вручную · {{ amountDeltaLabel }}</span>
            <button
              type="button"
              class="underline underline-offset-2 hover:no-underline"
              @click="resetAmountToServices"
            >
              вернуть
            </button>
          </p>
          <p v-if="amountOverridden" class="mt-1 text-xs text-muted-foreground">
            При изменении услуг, их цен или класса кузова сумма пересчитается автоматически.
          </p>
          <p v-if="submitAttempted && errors.amount" class="text-sm font-medium text-destructive mt-1">
            {{ errors.amount }}
          </p>

          <Label class="mt-4 mb-2 block">
            Скидка
            <span class="text-muted-foreground font-normal">(необязательно)</span>
          </Label>
          <div class="flex gap-2">
            <div class="inline-flex h-11 items-center rounded-md border border-input bg-background p-1 shrink-0">
              <button
                type="button"
                :data-active="discountUnit === 'rub'"
                class="h-full px-3 rounded-sm text-sm transition-colors hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                @click="setDiscountUnit('rub')"
              >
                ₽
              </button>
              <button
                type="button"
                :data-active="discountUnit === 'pct'"
                class="h-full px-3 rounded-sm text-sm transition-colors hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                @click="setDiscountUnit('pct')"
              >
                %
              </button>
            </div>
            <div class="relative flex-1">
              <Input
                type="text"
                inputmode="numeric"
                class="h-11 pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                placeholder="0"
                :model-value="discountRaw"
                @input="onDiscountInput"
              />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {{ discountUnit === 'pct' ? '%' : '₽' }}
              </span>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span class="text-sm text-muted-foreground">Итого к оплате</span>
            <span class="tabular-nums font-semibold">
              {{ formatAmount(String(finalAmount)) }} ₽
              <span v-if="hasDiscount" class="ml-1 text-xs font-normal text-muted-foreground">
                (−{{ formatAmount(String(discountAmount)) }} ₽)
              </span>
            </span>
          </div>
          </CardContent>
        </Card>

        <!-- Статус -->
        <Card class="gap-4 py-4 shadow-none">
          <CardHeader class="px-4">
            <CardTitle class="text-base">Статус</CardTitle>
          </CardHeader>
          <CardContent class="px-4">
          <div class="space-y-4">
            <Alert v-if="mastersWarning" variant="destructive">
              <AlertDescription>{{ mastersWarning }}</AlertDescription>
            </Alert>
            <FormField v-slot="{ componentField }" name="master">
              <FormItem>
                <FormLabel>Мастер</FormLabel>
                <Select v-bind="componentField">
                  <FormControl>
                    <SelectTrigger class="h-11">
                      <SelectValue placeholder="Не выбрано" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem
                      v-for="m in mastersForMaster"
                      :key="m"
                      :value="m"
                    >
                      {{ m }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            </FormField>

            <FormField v-slot="{ componentField }" name="responsible">
              <FormItem>
                <FormLabel>Ответственный</FormLabel>
                <Select v-bind="componentField">
                  <FormControl>
                    <SelectTrigger class="h-11">
                      <SelectValue placeholder="Не выбрано" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem
                      v-for="r in mastersForResponsible"
                      :key="r"
                      :value="r"
                    >
                      {{ r }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            </FormField>

            <!-- Уведомление доступно только если у выбранного мастера указан
                 Telegram ID; иначе тоггл выключен и заблокирован. -->
            <div class="flex items-start gap-3 pt-2 border-t border-border">
              <Switch v-model="sendNotification" :disabled="!canNotifyMaster" />
              <div class="grid gap-1">
                <Label class="cursor-pointer" :class="{ 'opacity-50': !canNotifyMaster }">
                  Отправить уведомление
                </Label>
                <p v-if="!canNotifyMaster" class="text-xs text-muted-foreground">
                  {{ notifyHint }}
                </p>
              </div>
            </div>
          </div>
          </CardContent>
        </Card>
      </div>
    </form>

    <!-- Sticky submit bar (safe-area aware) -->
    <div class="fixed bottom-0 left-0 right-0 md:left-64 px-4 py-4 bg-background border-t border-border pb-safe">
      <div class="max-w-lg mx-auto px-4">
        <Button
          type="button"
          class="w-full h-12 text-base font-medium"
          :disabled="isSubmitting"
          @click="onSubmit"
        >
          <span v-if="isSubmitting" class="flex items-center gap-2">
            <Spinner />
            Сохраняем...
          </span>
          <span v-else>Сохранить запись</span>
        </Button>
      </div>
    </div>
  </div>
</template>
