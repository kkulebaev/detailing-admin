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
  READINESS,
  MASTERS,
} from '@detailing-admin/shared'
import type { BookingApiResult } from '@detailing-admin/shared'
import { submitBooking } from '@/lib/api'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
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

// ── Multi-day toggle ──────────────────────────────────────────────────────────
const isMultiDay = ref(false)

// ── Calendar state ────────────────────────────────────────────────────────────
const localTz = getLocalTimeZone()
const todayVal = today(localTz)
// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it)
const dateFromCal = shallowRef<DateValue>(todayVal)
const dateToCal = shallowRef<DateValue>(todayVal)
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
    readiness: undefined,
    master: '',
    responsible: undefined,
  },
})

// ── Phone input handler ───────────────────────────────────────────────────────
// Bind via v-model="phoneRaw" — shadcn-vue Input uses useVModel internally, so
// :value+@input fought with its internal state and "ate" every other keystroke.
// With v-model, Vue already syncs phoneRaw from the DOM. The handler only steps
// in when formatPhone diverges from what the user typed (non-digit, leading 7/8,
// over-length) and rewrites both the ref and the DOM so the mask snaps back.
function onPhoneInput(e: Event) {
  const target = e.target as HTMLInputElement
  const formatted = formatPhone(target.value)
  if (target.value !== formatted) {
    phoneRaw.value = formatted
    target.value = formatted
    target.setSelectionRange(formatted.length, formatted.length)
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
  if (isMultiDay.value) setFieldValue('dateTo', masked)
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
  if (isMultiDay.value) setFieldValue('timeTo', masked)
}

// ── Amount input handler ──────────────────────────────────────────────────────
// amountRaw stores the formatted (with spaces) display value. Form field
// `amount` stores the parsed integer (or '' when empty).
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
  // avoid double-appending the same preset back-to-back
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
  if (isMultiDay.value) {
    setFieldValue('dateTo', str)
  }
  dateToOpen.value = false
}

function toggleMultiDay(val: boolean) {
  isMultiDay.value = val
  if (val) {
    setFieldValue('dateTo', dateToText.value)
    setFieldValue('timeTo', timeToValue.value)
  } else {
    setFieldValue('dateTo', undefined)
    setFieldValue('timeTo', undefined)
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────
const handleValidatedSubmit = handleSubmit(async (values) => {
  unavailableBanner.value = null
  let result: BookingApiResult
  try {
    result = await submitBooking(values, idempotencyKey.value)
  } catch {
    // Network / fetch failure
    const retry = () => { void onSubmit() }
    toast.error('Ошибка при сохранении', {
      action: { label: 'Повторить', onClick: retry },
    })
    return
  }

  if (result.ok) {
    toast.success('Запись сохранена')
    idempotencyKey.value = uuid()
    resetForm({
      values: {
        dateFrom: calToString(today(localTz)),
        dateTo: undefined,
        time: '',
        name: '',
        phone: '',
        car: '',
        service: '',
        note: '',
        amount: '',
        readiness: undefined,
        master: '',
        responsible: undefined,
      },
    })
    phoneRaw.value = PHONE_PREFIX
    amountRaw.value = ''
    timeValue.value = ''
    timeToValue.value = ''
    dateFromText.value = calToString(today(localTz))
    dateToText.value = calToString(today(localTz))
    dateFromCal.value = today(localTz)
    dateToCal.value = today(localTz)
    isMultiDay.value = false
    submitAttempted.value = false
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

// Sync the masked raw phone into the form field once, then let vee-validate
// validate (which runs normalizePhone) and POST. See F7.
// Empty-out the prefix-only case so normalizePhone doesn't reject "+7 (" as garbage.
async function onSubmit() {
  submitAttempted.value = true
  setFieldValue('phone', effectivePhone())
  await handleValidatedSubmit()
}

// ── Draft persistence (localStorage) ─────────────────────────────────────────
const DRAFT_KEY = 'detailing-admin:booking-draft:v1'

interface Draft {
  dateFromText: string
  dateToText: string
  timeValue: string
  timeToValue: string
  isMultiDay: boolean
  name: string
  phoneRaw: string
  car: string
  service: string
  note: string
  amountRaw: string
  readiness?: string
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
      isMultiDay: isMultiDay.value,
      name: values.name ?? '',
      phoneRaw: phoneRaw.value,
      car: values.car ?? '',
      service: values.service ?? '',
      note: values.note ?? '',
      amountRaw: amountRaw.value,
      readiness: values.readiness,
      master: values.master,
      responsible: values.responsible,
    }
    // Don't persist an essentially-empty form
    const meaningful =
      draft.timeValue || draft.name || draft.car || draft.service ||
      draft.note || draft.amountRaw || draft.readiness || draft.master ||
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
    if (d.isMultiDay) {
      isMultiDay.value = true
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
    if (d.service) setFieldValue('service', d.service)
    if (d.note) setFieldValue('note', d.note)
    if (d.amountRaw) {
      amountRaw.value = d.amountRaw
      const digits = amountDigits(d.amountRaw)
      if (digits) setFieldValue('amount', parseInt(digits, 10))
    }
    if (d.readiness) setFieldValue('readiness', d.readiness as never)
    if (d.master) setFieldValue('master', d.master as never)
    if (d.responsible) setFieldValue('responsible', d.responsible as never)
    toast('Восстановлен черновик', {
      description: 'Если не хочешь — поправь любое поле или очисти страницу.',
    })
  } catch { /* corrupted draft: ignore */ }
}

onMounted(loadDraft)

// Debounce-ish: schedule a save on the next frame; coalesces bursts of edits
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
    dateFromText, dateToText, timeValue, timeToValue, isMultiDay,
    phoneRaw, amountRaw,
    () => values.name, () => values.car, () => values.service,
    () => values.note, () => values.readiness, () => values.master,
    () => values.responsible,
  ],
  scheduleSave,
)
</script>

<template>
  <div class="min-h-screen bg-background">
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
      <h1 class="text-xl font-semibold mb-6">Новая запись</h1>

      <!-- Date + time (typeable inputs with optional calendar popover) -->
      <div class="mb-4">
        <Label class="mb-2 block">Дата и время</Label>
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
        <p v-if="submitAttempted && errors.time" class="text-sm font-medium text-destructive mt-1">
          {{ errors.time }}
        </p>
      </div>

      <!-- Multi-day toggle -->
      <div class="flex items-center gap-3 mb-4">
        <Switch
          :checked="isMultiDay"
          @update:checked="toggleMultiDay"
        />
        <Label class="cursor-pointer">Несколько дней</Label>
      </div>

      <!-- Date + time of end (revealed when multi-day) -->
      <div v-if="isMultiDay" class="mb-4">
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
                  aria-label="Выбрать дату в календаре"
                  class="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0" align="start">
                <Calendar
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
        <p v-if="submitAttempted && errors.timeTo" class="text-sm font-medium text-destructive mt-1">
          {{ errors.timeTo }}
        </p>
        <p v-if="submitAttempted && errors.dateTo" class="text-sm font-medium text-destructive mt-1">
          {{ errors.dateTo }}
        </p>
      </div>

      <!-- Name -->
      <FormField v-slot="{ componentField }" name="name">
        <FormItem class="mb-4">
          <FormLabel>Имя</FormLabel>
          <FormControl>
            <Input
              type="text"
              class="h-11"
              placeholder="Иван"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- Phone (bound to raw masked string — outside FormField on purpose, see F7) -->
      <div class="mb-4">
        <Label class="mb-2 block">Номер телефона</Label>
        <Input
          type="tel"
          inputmode="tel"
          class="h-11"
          placeholder="+7 (___) ___-__-__"
          v-model="phoneRaw"
          @input="onPhoneInput"
        />
        <p v-if="errors.phone" class="text-sm font-medium text-destructive mt-1">
          {{ errors.phone }}
        </p>
      </div>

      <!-- Car -->
      <FormField v-slot="{ componentField }" name="car">
        <FormItem class="mb-4">
          <FormLabel>Машина</FormLabel>
          <FormControl>
            <Input
              type="text"
              class="h-11"
              placeholder="Toyota Camry"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- Service -->
      <FormField v-slot="{ componentField }" name="service">
        <FormItem class="mb-4">
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

      <!-- Note -->
      <FormField v-slot="{ componentField }" name="note">
        <FormItem class="mb-4">
          <FormLabel>Примечание</FormLabel>
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

      <!-- Amount (custom raw binding, outside FormField) -->
      <div class="mb-4">
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
        <p v-if="errors.amount" class="text-sm font-medium text-destructive mt-1">
          {{ errors.amount }}
        </p>
      </div>

      <!-- Readiness -->
      <FormField v-slot="{ componentField }" name="readiness">
        <FormItem class="mb-4">
          <FormLabel>Готовность</FormLabel>
          <Select v-bind="componentField">
            <FormControl>
              <SelectTrigger class="h-11">
                <SelectValue placeholder="Не выбрано" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem
                v-for="r in READINESS"
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

      <!-- Master -->
      <FormField v-slot="{ componentField }" name="master">
        <FormItem class="mb-4">
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

      <!-- Responsible -->
      <FormField v-slot="{ componentField }" name="responsible">
        <FormItem class="mb-4">
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
    </form>

    <!-- Sticky submit button (safe-area aware) -->
    <div class="fixed bottom-0 left-0 right-0 px-4 py-4 bg-background border-t border-border pb-safe">
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
</template>
