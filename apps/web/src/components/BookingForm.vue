<script setup lang="ts">
import { ref, shallowRef, computed } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { v4 as uuid } from 'uuid'
import { toast } from 'vue-sonner'
import { today, getLocalTimeZone } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import {
  bookingSchema,
  READINESS,
  RESPONSIBLES,
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
// Time value is kept locally so we can show it inside the date Popover trigger
// label. setFieldValue('time', …) keeps the vee-validate form state in sync.
const timeValue = ref('')

function calToString(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

const dateFromLabel = computed(() => {
  const date = calToString(dateFromCal.value)
  return timeValue.value ? `${date} ${timeValue.value}` : date
})

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
// ── Amount display value ──────────────────────────────────────────────────────
const amountRaw = ref('')

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
  errors,
  isSubmitting,
} = useForm({
  validationSchema: toTypedSchema(bookingSchema),
  initialValues: {
    dateFrom: calToString(todayVal),
    dateTo: undefined as string | undefined,
    time: '',
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

// ── Time input handler ───────────────────────────────────────────────────────
function onTimeInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  timeValue.value = v
  setFieldValue('time', v)
}

// ── Amount input handler ──────────────────────────────────────────────────────
// Same v-model pattern as phone — shadcn Input's useVModel races with :value.
function onAmountInput(e: Event) {
  const target = e.target as HTMLInputElement
  const stripped = target.value.replace(/\D/g, '')
  if (target.value !== stripped) {
    amountRaw.value = stripped
    target.value = stripped
    target.setSelectionRange(stripped.length, stripped.length)
  }
  const parsed: '' | number = stripped === '' ? '' : parseInt(stripped, 10)
  setFieldValue('amount', parsed)
}

// ── Calendar selection handlers ───────────────────────────────────────────────
function onDateFromSelect(date: DateValue | undefined) {
  if (!date) return
  dateFromCal.value = date
  setFieldValue('dateFrom', calToString(date))
  dateFromOpen.value = false
}

function onDateToSelect(date: DateValue | undefined) {
  if (!date) return
  dateToCal.value = date
  if (isMultiDay.value) {
    setFieldValue('dateTo', calToString(date))
  }
  dateToOpen.value = false
}

function toggleMultiDay(val: boolean) {
  isMultiDay.value = val
  if (val) {
    setFieldValue('dateTo', calToString(dateToCal.value))
  } else {
    setFieldValue('dateTo', undefined)
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
    dateFromCal.value = today(localTz)
    dateToCal.value = today(localTz)
    isMultiDay.value = false
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
  setFieldValue('phone', effectivePhone())
  await handleValidatedSubmit()
}
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

      <!-- Date + time (single popover) -->
      <FormField name="dateFrom">
        <FormItem class="mb-4">
          <FormLabel>Дата и время</FormLabel>
          <Popover v-model:open="dateFromOpen">
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="outline"
                class="w-full h-11 justify-start font-normal"
              >
                {{ dateFromLabel }}
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                :model-value="dateFromCal"
                @update:model-value="onDateFromSelect"
              />
              <div class="border-t p-3 flex items-center gap-3">
                <Label for="booking-time" class="text-sm font-medium">Время</Label>
                <input
                  id="booking-time"
                  type="time"
                  :value="timeValue"
                  @input="onTimeInput"
                  class="border-input bg-transparent flex h-9 w-32 rounded-md border px-3 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                >
              </div>
            </PopoverContent>
          </Popover>
          <p v-if="errors.time" class="text-sm font-medium text-destructive mt-1">
            {{ errors.time }}
          </p>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- Multi-day toggle -->
      <div class="flex items-center gap-3 mb-4">
        <Switch
          :checked="isMultiDay"
          @update:checked="toggleMultiDay"
        />
        <Label class="cursor-pointer">Несколько дней</Label>
      </div>

      <!-- Date to (revealed when multi-day) -->
      <FormField v-if="isMultiDay" name="dateTo">
        <FormItem class="mb-4">
          <FormLabel>по</FormLabel>
          <Popover v-model:open="dateToOpen">
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="outline"
                class="w-full h-11 justify-start font-normal"
              >
                {{ calToString(dateToCal) }}
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                :model-value="dateToCal"
                @update:model-value="onDateToSelect"
              />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      </FormField>

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

      <!-- Master (free text for MVP) -->
      <FormField v-slot="{ componentField }" name="master">
        <FormItem class="mb-4">
          <FormLabel>Мастер</FormLabel>
          <FormControl>
            <Input type="text" class="h-11" v-bind="componentField" />
          </FormControl>
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
                v-for="r in RESPONSIBLES"
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
