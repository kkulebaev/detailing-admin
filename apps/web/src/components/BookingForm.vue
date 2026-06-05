<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { v4 as uuid } from 'uuid'
import { toast } from 'vue-sonner'
import { today, getLocalTimeZone, CalendarDate } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import {
  bookingSchema,
  MASTERS,
} from '@detailing-admin/shared'
import type { BookingApiResult } from '@detailing-admin/shared'
import { submitBooking } from '@/lib/api'
import { CAR_SUGGESTIONS } from '@/lib/car-suggestions'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Calendar } from '@/components/ui/calendar'
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

// ── Idempotency key: same across retries, regenerated on success ──────────────
const idempotencyKey = ref(uuid())

// TODO: уведомления пока не реализованы — этот тоггл только для UI,
// серверной отправки нет.
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

// ── Phone raw display value (NOT the zod-transformed output) ─────────────────
// Always starts with the +7 prefix so the first user keystroke is the first
// significant digit, not a country code re-entry.
const PHONE_PREFIX = '+7 ('
const phoneRaw = ref(PHONE_PREFIX)
// ── License plate (UI-only, concatenated into `car` on submit) ───────────────
const licensePlate = ref('')
// ── Amount display value (formatted with thousand separators) ────────────────
const amountRaw = ref('')

function formatAmount(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function amountDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

// ── Quick-pick presets ───────────────────────────────────────────────────────
const SERVICE_PRESETS = [
  'Полная мойка',
  'Химчистка',
  'Полировка',
  'Тонировка',
  'Оклейка фар',
  'Антихром',
] as const

const AMOUNT_PRESETS = [1000, 5000, 10000, 50000] as const

// Working hours of the detailing shop: 10:00–18:30 in 30-minute slots.
const TIME_PRESETS = [
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
] as const

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  // strip leading 7 or 8 — they're absorbed into the +7 prefix
  let base = digits
  if (base.startsWith('7') || base.startsWith('8')) base = base.slice(1)
  const d = base.slice(0, 10)
  if (d.length === 0) return PHONE_PREFIX
  if (d.length <= 3) return `+7 (${d}`
  if (d.length <= 6) return `+7 (${d.slice(0, 3)}) ${d.slice(3)}`
  if (d.length <= 8) return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`
}

// Pasted strings may carry a country code, separators, or no prefix at all.
// Reduce to the 10 significant digits before reusing formatPhone — typing
// goes through a different path that can't safely strip a "leading 7/8" twice.
function formatPastedPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  let ten = digits
  if (ten.length === 11 && (ten.startsWith('7') || ten.startsWith('8'))) {
    ten = ten.slice(1)
  } else if (ten.length > 10) {
    ten = ten.slice(-10)
  }
  return formatPhone(ten)
}

// Returns the phone value to send on submit:
//   '' when the user hasn't typed any real digits past the prefix,
//   the raw masked string otherwise (server transform normalises to E.164).
function effectivePhone(): string {
  const digits = phoneRaw.value.replace(/\D/g, '')
  return digits.length <= 1 ? '' : phoneRaw.value
}

// ── Form ──────────────────────────────────────────────────────────────────────
const {
  handleSubmit,
  setFieldValue,
  setFieldError,
  resetForm,
  values,
  errors,
  isSubmitting,
} = useForm({
  validationSchema: toTypedSchema(bookingSchema),
  initialValues: {
    dateFrom: calToString(todayVal),
    dateTo: undefined as string | undefined,
    time: '',
    timeTo: undefined as string | undefined,
    name: '',
    phone: '',
    car: '',
    service: '',
    note: '',
    amount: '' as '' | number,
    master: '',
    responsible: undefined,
  },
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

// ── Phone input handler ───────────────────────────────────────────────────────
function onPhoneInput(e: Event) {
  const target = e.target as HTMLInputElement
  const formatted = formatPhone(target.value)
  if (target.value !== formatted) {
    phoneRaw.value = formatted
    target.value = formatted
    target.setSelectionRange(formatted.length, formatted.length)
  }
}

function onPhonePaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!text) return
  e.preventDefault()
  phoneRaw.value = formatPastedPhone(text)
}

async function onClickPastePhone() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      toast.error('Буфер обмена пуст')
      return
    }
    phoneRaw.value = formatPastedPhone(text)
  } catch {
    toast.error('Не удалось прочитать буфер обмена')
  }
}

// ── Date / time text input handlers ──────────────────────────────────────────
function onDateFromTextInput(e: Event) {
  const target = e.target as HTMLInputElement
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
  const target = e.target as HTMLInputElement
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
  const target = e.target as HTMLInputElement
  const masked = maskTimeText(target.value)
  if (target.value !== masked) {
    timeValue.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('time', masked)
}

function onTimeToTextInput(e: Event) {
  const target = e.target as HTMLInputElement
  const masked = maskTimeText(target.value)
  if (target.value !== masked) {
    timeToValue.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('timeTo', masked)
}

function onNameInput(e: Event) {
  const target = e.target as HTMLInputElement
  const masked = maskName(target.value)
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('name', masked)
}

function onCarInput(e: Event) {
  carPopoverOpen.value = true
  const target = e.target as HTMLInputElement
  const masked = maskCar(target.value)
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  setFieldValue('car', masked)
}

function onLicensePlateInput(e: Event) {
  const target = e.target as HTMLInputElement
  const masked = maskLicensePlate(target.value)
  if (target.value !== masked) {
    licensePlate.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
}

// ── Amount input handler ──────────────────────────────────────────────────────
function onAmountInput(e: Event) {
  const target = e.target as HTMLInputElement
  const digits = amountDigits(target.value)
  const formatted = formatAmount(digits)
  if (target.value !== formatted) {
    amountRaw.value = formatted
    target.value = formatted
    target.setSelectionRange(formatted.length, formatted.length)
  }
  const parsed: '' | number = digits === '' ? '' : parseInt(digits, 10)
  setFieldValue('amount', parsed)
}

function addAmount(delta: number) {
  const current = parseInt(amountDigits(amountRaw.value), 10) || 0
  const next = current + delta
  amountRaw.value = formatAmount(String(next))
  setFieldValue('amount', next)
}

function addServicePreset(text: string) {
  const current = (values.service ?? '').trim()
  if (!current) {
    setFieldValue('service', text)
    return
  }
  if (current.endsWith(text)) return
  setFieldValue('service', `${current}, ${text}`)
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
  const payload = { ...values, car }
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
    toast.success('Запись сохранена')
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
    type BookingField = 'dateFrom' | 'dateTo' | 'time' | 'name' | 'phone' | 'car' | 'service' | 'note' | 'amount' | 'readiness' | 'master' | 'responsible'
    for (const issue of result.issues) {
      const field = issue.path[0]
      if (typeof field === 'string') {
        setFieldError(field as BookingField, issue.message)
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
      master: '',
      responsible: undefined,
    },
  })
  phoneRaw.value = PHONE_PREFIX
  licensePlate.value = ''
  amountRaw.value = ''
  timeValue.value = ''
  timeToValue.value = ''
  dateFromText.value = calToString(fresh)
  dateToText.value = calToString(fresh)
  dateFromCal.value = fresh
  dateToCal.value = fresh
  isRangeMode.value = false
  sendNotification.value = true
  submitAttempted.value = false
}

function clearForm() {
  resetFormState()
  idempotencyKey.value = uuid()
  unavailableBanner.value = null
  clearDraft()
}

// ── Draft persistence (localStorage) ─────────────────────────────────────────
// v4: license plate field added.
const DRAFT_KEY = 'detailing-admin:booking-draft:v4'

interface Draft {
  dateFromText: string
  dateToText: string
  timeValue: string
  timeToValue: string
  isRangeMode: boolean
  name: string
  phoneRaw: string
  car: string
  licensePlate: string
  service: string
  note: string
  amountRaw: string
  master?: string
  responsible?: string
}

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
      master: values.master,
      responsible: values.responsible,
    }
    const meaningful =
      draft.isRangeMode || draft.timeValue || draft.name || draft.car || draft.licensePlate ||
      draft.service || draft.note || draft.amountRaw || draft.master ||
      draft.responsible || (draft.phoneRaw && draft.phoneRaw !== PHONE_PREFIX)
    if (!meaningful) { clearDraft(); return }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch { /* ignore */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as Partial<Draft>
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
    if (d.master) setFieldValue('master', d.master as never)
    if (d.responsible) setFieldValue('responsible', d.responsible as never)
  } catch { /* corrupted draft: ignore */ }
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
    phoneRaw, licensePlate, amountRaw,
    () => values.name, () => values.car, () => values.service,
    () => values.note, () => values.master,
    () => values.responsible,
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
        <section class="rounded-xl border border-border bg-card p-4">
          <h2 class="text-base font-semibold mb-4">Дата и время записи</h2>

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
                @input="onDateFromTextInput"
              />
              <Popover v-model:open="dateFromOpen">
                <PopoverTrigger as-child>
                  <button
                    type="button"
                    aria-label="Выбрать дату в календаре"
                    class="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
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
                        @input="onDateToTextInput"
                      />
                      <Popover v-model:open="dateToOpen">
                        <PopoverTrigger as-child>
                          <button
                            type="button"
                            aria-label="Выбрать дату окончания в календаре"
                            class="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
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
        </section>

        <!-- Информация о клиенте -->
        <section class="rounded-xl border border-border bg-card p-4">
          <h2 class="text-base font-semibold mb-4">Информация о клиенте</h2>
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
                  v-model="phoneRaw"
                  @input="onPhoneInput"
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
                Гос.номер
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
        </section>

        <!-- Объем работ -->
        <section class="rounded-xl border border-border bg-card p-4">
          <h2 class="text-base font-semibold mb-4">Объем работ</h2>
          <div class="space-y-4">
            <FormField v-slot="{ componentField }" name="service">
              <FormItem>
                <FormLabel>Услуга</FormLabel>
                <div class="flex flex-wrap gap-2 mb-2">
                  <button
                    v-for="preset in SERVICE_PRESETS"
                    :key="preset"
                    type="button"
                    class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors"
                    @click="addServicePreset(preset)"
                  >
                    + {{ preset }}
                  </button>
                </div>
                <FormControl>
                  <Textarea
                    rows="3"
                    placeholder="Полировка, химчистка..."
                    class="[field-sizing:content]"
                    v-bind="componentField"
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
        </section>

        <!-- Оплата -->
        <section class="rounded-xl border border-border bg-card p-4">
          <h2 class="text-base font-semibold mb-4">Оплата</h2>
          <Label class="mb-2 block">Сумма, ₽</Label>
          <Input
            type="text"
            inputmode="numeric"
            class="h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="0"
            v-model="amountRaw"
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
          <p v-if="submitAttempted && errors.amount" class="text-sm font-medium text-destructive mt-1">
            {{ errors.amount }}
          </p>
        </section>

        <!-- Статус -->
        <section class="rounded-xl border border-border bg-card p-4">
          <h2 class="text-base font-semibold mb-4">Статус</h2>
          <div class="space-y-4">
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
                      v-for="m in MASTERS"
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
                      v-for="r in MASTERS"
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

            <!-- Уведомление — заглушка, серверная отправка пока не подключена -->
            <div class="flex items-center gap-3 pt-2 border-t border-border">
              <Switch v-model="sendNotification" />
              <Label class="cursor-pointer">Отправить уведомление</Label>
            </div>
          </div>
        </section>
      </div>
    </form>

    <!-- Sticky submit bar (safe-area aware) -->
    <div class="fixed bottom-0 left-0 right-0 md:left-64 px-4 py-4 bg-background border-t border-border pb-safe">
      <div class="max-w-lg mx-auto">
        <Button
          type="button"
          class="w-full h-12 text-base font-medium"
          :disabled="isSubmitting"
          @click="onSubmit"
        >
          <span v-if="isSubmitting" class="flex items-center gap-2">
            <svg class="animate-spin size-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Сохраняем...
          </span>
          <span v-else>Сохранить запись</span>
        </Button>
      </div>
    </div>
  </div>
</template>
