<script setup lang="ts">
import { ref, shallowRef, nextTick } from 'vue'
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

function calToString(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
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
const phoneRaw = ref('')
// ── Amount display value ──────────────────────────────────────────────────────
const amountRaw = ref('')

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  // strip leading 7 or 8 (will be re-added as +7)
  let base = digits
  if (base.startsWith('7') || base.startsWith('8')) base = base.slice(1)
  const d = base.slice(0, 10)
  if (d.length === 0) return ''
  if (d.length <= 3) return `+7 (${d}`
  if (d.length <= 6) return `+7 (${d.slice(0, 3)}) ${d.slice(3)}`
  if (d.length <= 8) return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`
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
// Bind ONLY the raw ref to the input; do not call setFieldValue on every keystroke.
// vee-validate would otherwise re-run the schema (including normalizePhone, which
// throws on partial input) and flash a transient phone error mid-typing.
// We sync phoneRaw -> form field once in onSubmit (below).
function onPhoneInput(e: Event) {
  const target = e.target as HTMLInputElement
  const formatted = formatPhone(target.value)
  phoneRaw.value = formatted
  void nextTick(() => {
    target.value = formatted
    target.setSelectionRange(formatted.length, formatted.length)
  })
}

// ── Amount input handler ──────────────────────────────────────────────────────
function onAmountInput(e: Event) {
  const target = e.target as HTMLInputElement
  const val = target.value.replace(/\D/g, '')
  amountRaw.value = val
  const parsed: '' | number = val === '' ? '' : parseInt(val, 10)
  setFieldValue('amount', parsed)
  void nextTick(() => {
    target.value = val
  })
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
    phoneRaw.value = ''
    amountRaw.value = ''
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
async function onSubmit() {
  setFieldValue('phone', phoneRaw.value)
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

      <!-- Date from -->
      <FormField name="dateFrom">
        <FormItem class="mb-4">
          <FormLabel>Дата</FormLabel>
          <Popover v-model:open="dateFromOpen">
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="outline"
                class="w-full h-11 justify-start font-normal"
              >
                {{ calToString(dateFromCal) }}
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                :model-value="dateFromCal"
                @update:model-value="onDateFromSelect"
              />
            </PopoverContent>
          </Popover>
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

      <!-- Time -->
      <FormField v-slot="{ componentField }" name="time">
        <FormItem class="mb-4">
          <FormLabel>Время</FormLabel>
          <FormControl>
            <Input type="time" class="h-11" v-bind="componentField" />
          </FormControl>
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

      <!-- Phone (bound to raw masked string) -->
      <FormItem class="mb-4">
        <FormLabel>Номер телефона</FormLabel>
        <FormControl>
          <Input
            type="tel"
            inputmode="tel"
            class="h-11"
            placeholder="+7 (___) ___-__-__"
            :value="phoneRaw"
            @input="onPhoneInput"
          />
        </FormControl>
        <p v-if="errors.phone" class="text-sm font-medium text-destructive mt-1">
          {{ errors.phone }}
        </p>
      </FormItem>

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

      <!-- Amount -->
      <FormItem class="mb-4">
        <FormLabel>Сумма, ₽</FormLabel>
        <FormControl>
          <Input
            type="text"
            inputmode="numeric"
            class="h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="0"
            :value="amountRaw"
            @input="onAmountInput"
          />
        </FormControl>
        <p v-if="errors.amount" class="text-sm font-medium text-destructive mt-1">
          {{ errors.amount }}
        </p>
      </FormItem>

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
