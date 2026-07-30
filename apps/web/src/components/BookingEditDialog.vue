<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Calendar as CalendarIcon, X } from '@lucide/vue'
import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'
import {
  bookingSchema,
  DEFAULT_CAR_CLASS,
  READINESS,
  type BookingRow,
} from '@detailing-admin/shared'
import { updateBooking, type PatchApiBookingsIdBody } from '@/lib/bookings-api'
import { useMastersQuery } from '@/lib/queries'
import { resolveMasterOptions } from '@/lib/master-options'
import { formatPastedPhone, usePhoneInput } from '@/composables/use-phone-input'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
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

const props = defineProps<{
  open: boolean
  booking: BookingRow | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

// reka-ui Select rejects an empty value, so the «нет статуса» option rides on a
// sentinel the payload builder maps back to '' (the schema's empty readiness).
const READINESS_NONE = '__none__'

const CAR_CLASS_OPTIONS = [
  { value: '1', label: 'I' },
  { value: '2', label: 'II' },
  { value: '3', label: 'III' },
  { value: '4', label: 'IV' },
] as const

// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it).
const dateFromCal = shallowRef<DateValue | undefined>(undefined)
const dateToCal = shallowRef<DateValue | undefined>(undefined)
const dateFromOpen = ref(false)
const dateToOpen = ref(false)

const timeValue = ref('')
const timeToValue = ref('')
const name = ref('')
const car = ref('')
const service = ref('')
const note = ref('')
const amountRaw = ref('')
const readiness = ref<string>(READINESS_NONE)
const master = ref<string | undefined>(undefined)
const responsible = ref<string | undefined>(undefined)
const carClass = ref<string>(String(DEFAULT_CAR_CLASS))

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const {
  phoneRaw,
  effectivePhone,
  onPhoneInput,
  onPhoneKeydown,
  onPhonePaste,
  onClickPastePhone,
  resetPhone,
} = usePhoneInput()

const { data: mastersData } = useMastersQuery()

// Include the booking's current master/responsible even if it's no longer in the
// live list, so an edit doesn't silently drop a value the row already holds.
const masterOptions = computed(() => {
  const base = resolveMasterOptions(
    mastersData.value?.ok ? mastersData.value.masters : undefined,
    () => true,
  )
  const cur = master.value
  return cur && !base.includes(cur) ? [cur, ...base] : base
})
const responsibleOptions = computed(() => {
  const base = resolveMasterOptions(
    mastersData.value?.ok ? mastersData.value.masters : undefined,
    (m) => m.canBeResponsible,
  )
  const cur = responsible.value
  return cur && !base.includes(cur) ? [cur, ...base] : base
})

function isoToCal(iso: string): DateValue | undefined {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return undefined
  try {
    return new CalendarDate(y, m, d)
  } catch {
    return undefined
  }
}

function calToDdmmyyyy(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

function maskTimeText(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

function formatAmount(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function amountDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    const b = props.booking
    error.value = null
    fieldErrors.value = {}
    dateFromCal.value = b ? isoToCal(b.dateFrom) : undefined
    dateToCal.value = b?.dateTo ? isoToCal(b.dateTo) : undefined
    timeValue.value = b?.timeFrom ?? ''
    timeToValue.value = b?.timeTo ?? ''
    name.value = b?.name ?? ''
    if (b?.phone) phoneRaw.value = formatPastedPhone(b.phone)
    else resetPhone()
    car.value = b?.car ?? ''
    service.value = b?.service ?? ''
    note.value = b?.note ?? ''
    amountRaw.value = b?.amount != null ? formatAmount(String(b.amount)) : ''
    readiness.value =
      b && READINESS.some((r) => r === b.readiness) ? b.readiness : READINESS_NONE
    master.value = b?.master ? b.master : undefined
    responsible.value = b?.responsible ? b.responsible : undefined
    carClass.value = b ? String(b.carClass) : String(DEFAULT_CAR_CLASS)
  },
)

function onTimeInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  timeValue.value = masked
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
}

function onTimeToInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  timeToValue.value = masked
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
}

function onAmountInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = formatAmount(amountDigits(target.value))
  amountRaw.value = masked
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
}

function onDateFromSelect(d: DateValue | undefined) {
  if (d) dateFromCal.value = d
  dateFromOpen.value = false
}

function onDateToSelect(d: DateValue | undefined) {
  if (d) dateToCal.value = d
  dateToOpen.value = false
}

function clearDateTo() {
  dateToCal.value = undefined
  timeToValue.value = ''
}

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  if (!props.booking) return
  fieldErrors.value = {}
  error.value = null

  const digits = amountDigits(amountRaw.value)
  const rawInput = {
    dateFrom: dateFromCal.value ? calToDdmmyyyy(dateFromCal.value) : '',
    dateTo: dateToCal.value ? calToDdmmyyyy(dateToCal.value) : undefined,
    time: timeValue.value.trim(),
    timeTo: timeToValue.value.trim() ? timeToValue.value.trim() : undefined,
    name: name.value.trim(),
    phone: effectivePhone(),
    car: car.value.trim(),
    service: service.value.trim(),
    note: note.value,
    amount: digits === '' ? '' : parseInt(digits, 10),
    readiness: readiness.value === READINESS_NONE ? '' : readiness.value,
    master: master.value ?? '',
    responsible: responsible.value ?? '',
    carClass: Number(carClass.value),
  }

  const parsed = bookingSchema.safeParse(rawInput)
  if (!parsed.success) {
    const mapped: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      if (!(key in mapped)) mapped[key] = issue.message
    }
    fieldErrors.value = mapped
    error.value = parsed.error.issues[0]?.message ?? 'Проверьте заполнение полей'
    return
  }

  // The transform re-runs on the backend; ship the input shape and drop the
  // auto-derived formula (a manual edit resets it) and the notify flag.
  const payload: PatchApiBookingsIdBody = {
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    time: parsed.data.time,
    timeTo: parsed.data.timeTo,
    name: parsed.data.name,
    phone: parsed.data.phone,
    car: parsed.data.car,
    service: parsed.data.service,
    note: parsed.data.note,
    amount: parsed.data.amount,
    readiness: parsed.data.readiness,
    master: parsed.data.master,
    responsible: parsed.data.responsible,
    carClass: parsed.data.carClass,
  }

  submitting.value = true
  try {
    const result = await updateBooking(props.booking.id, payload)
    if (result.ok) {
      toast.success('Запись обновлена')
      emit('saved')
      emit('update:open', false)
      return
    }
    if (result.error === 'validation') {
      const mapped: Record<string, string> = {}
      for (const i of result.issues) {
        const key = String(i.path[0] ?? '_')
        if (!(key in mapped)) mapped[key] = i.message
      }
      fieldErrors.value = mapped
      error.value = result.issues[0]?.message ?? 'Неверные данные'
    } else if (result.error === 'not_found') {
      error.value = 'Запись не найдена — возможно, была удалена'
    } else if (result.error === 'unavailable') {
      error.value = result.message
    } else {
      error.value = 'Не удалось сохранить запись'
    }
  } catch {
    error.value = 'Не удалось сохранить запись'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-lg max-h-svh overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Редактировать запись</DialogTitle>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <!-- Дата и время -->
        <div class="grid gap-2">
          <Label>Дата и время</Label>
          <div class="flex gap-2">
            <Popover v-model:open="dateFromOpen">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  class="flex-1 justify-start gap-2 font-normal"
                  :disabled="submitting"
                >
                  <CalendarIcon class="size-4" />
                  <span :class="{ 'text-muted-foreground': !dateFromCal }">
                    {{ dateFromCal ? calToDdmmyyyy(dateFromCal) : 'ДД.ММ.ГГГГ' }}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0" align="start">
                <Calendar
                  locale="ru-RU"
                  :model-value="dateFromCal"
                  @update:model-value="onDateFromSelect"
                />
              </PopoverContent>
            </Popover>
            <Input
              type="text"
              inputmode="numeric"
              class="w-24"
              placeholder="ЧЧ:ММ"
              :disabled="submitting"
              v-model="timeValue"
              @input="onTimeInput"
            />
          </div>
          <p v-if="fieldErrors.dateFrom" class="text-sm text-destructive">
            {{ fieldErrors.dateFrom }}
          </p>
          <p v-if="fieldErrors.time" class="text-sm text-destructive">
            {{ fieldErrors.time }}
          </p>
        </div>

        <!-- Окончание (необязательно) -->
        <div class="grid gap-2">
          <Label>Окончание <span class="text-muted-foreground font-normal">(необязательно)</span></Label>
          <div class="flex gap-2">
            <Popover v-model:open="dateToOpen">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  class="flex-1 justify-start gap-2 font-normal"
                  :disabled="submitting"
                >
                  <CalendarIcon class="size-4" />
                  <span :class="{ 'text-muted-foreground': !dateToCal }">
                    {{ dateToCal ? calToDdmmyyyy(dateToCal) : 'ДД.ММ.ГГГГ' }}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-0" align="start">
                <Calendar
                  locale="ru-RU"
                  :model-value="dateToCal"
                  @update:model-value="onDateToSelect"
                />
              </PopoverContent>
            </Popover>
            <Input
              type="text"
              inputmode="numeric"
              class="w-24"
              placeholder="ЧЧ:ММ"
              :disabled="submitting"
              v-model="timeToValue"
              @input="onTimeToInput"
            />
            <Button
              v-if="dateToCal || timeToValue"
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Очистить дату окончания"
              :disabled="submitting"
              @click="clearDateTo"
            >
              <X class="size-4" />
            </Button>
          </div>
          <p v-if="fieldErrors.dateTo" class="text-sm text-destructive">
            {{ fieldErrors.dateTo }}
          </p>
          <p v-if="fieldErrors.timeTo" class="text-sm text-destructive">
            {{ fieldErrors.timeTo }}
          </p>
        </div>

        <!-- Имя -->
        <div class="grid gap-2">
          <Label for="booking-name">Имя</Label>
          <Input
            id="booking-name"
            v-model="name"
            :disabled="submitting"
            autocomplete="off"
            maxlength="120"
          />
          <p v-if="fieldErrors.name" class="text-sm text-destructive">
            {{ fieldErrors.name }}
          </p>
        </div>

        <!-- Телефон -->
        <div class="grid gap-2">
          <Label for="booking-phone">Телефон</Label>
          <div class="relative">
            <Input
              id="booking-phone"
              type="tel"
              inputmode="tel"
              class="pr-24"
              placeholder="+7 (___) ___-__-__"
              autocomplete="off"
              :disabled="submitting"
              :model-value="phoneRaw"
              @input="onPhoneInput"
              @keydown="onPhoneKeydown"
              @paste="onPhonePaste"
            />
            <button
              type="button"
              aria-label="Вставить номер из буфера обмена"
              class="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-3 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground text-xs font-medium disabled:opacity-50"
              :disabled="submitting"
              @click="onClickPastePhone"
            >
              Вставить
            </button>
          </div>
          <p v-if="fieldErrors.phone" class="text-sm text-destructive">
            {{ fieldErrors.phone }}
          </p>
        </div>

        <!-- Машина -->
        <div class="grid gap-2">
          <Label for="booking-car">Машина</Label>
          <Input
            id="booking-car"
            v-model="car"
            :disabled="submitting"
            autocomplete="off"
            maxlength="200"
          />
          <p v-if="fieldErrors.car" class="text-sm text-destructive">
            {{ fieldErrors.car }}
          </p>
        </div>

        <!-- Класс кузова -->
        <div class="grid gap-2">
          <Label>Класс кузова</Label>
          <Select v-model="carClass">
            <SelectTrigger :disabled="submitting">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="c in CAR_CLASS_OPTIONS" :key="c.value" :value="c.value">
                {{ c.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="fieldErrors.carClass" class="text-sm text-destructive">
            {{ fieldErrors.carClass }}
          </p>
        </div>

        <!-- Услуга -->
        <div class="grid gap-2">
          <Label for="booking-service">Услуга</Label>
          <Textarea
            id="booking-service"
            v-model="service"
            rows="3"
            class="[field-sizing:content]"
            :disabled="submitting"
            maxlength="2000"
          />
          <p v-if="fieldErrors.service" class="text-sm text-destructive">
            {{ fieldErrors.service }}
          </p>
        </div>

        <!-- Примечание -->
        <div class="grid gap-2">
          <Label for="booking-note">
            Примечание <span class="text-muted-foreground font-normal">(необязательно)</span>
          </Label>
          <Textarea
            id="booking-note"
            v-model="note"
            rows="2"
            class="[field-sizing:content]"
            :disabled="submitting"
            maxlength="2000"
          />
          <p v-if="fieldErrors.note" class="text-sm text-destructive">
            {{ fieldErrors.note }}
          </p>
        </div>

        <!-- Сумма -->
        <div class="grid gap-2">
          <Label for="booking-amount">Сумма, ₽</Label>
          <Input
            id="booking-amount"
            type="text"
            inputmode="numeric"
            placeholder="0"
            :disabled="submitting"
            v-model="amountRaw"
            @input="onAmountInput"
          />
          <p v-if="fieldErrors.amount" class="text-sm text-destructive">
            {{ fieldErrors.amount }}
          </p>
        </div>

        <!-- Мастер -->
        <div class="grid gap-2">
          <Label>Мастер</Label>
          <Select v-model="master">
            <SelectTrigger :disabled="submitting">
              <SelectValue placeholder="Не выбрано" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in masterOptions" :key="m" :value="m">
                {{ m }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="fieldErrors.master" class="text-sm text-destructive">
            {{ fieldErrors.master }}
          </p>
        </div>

        <!-- Ответственный -->
        <div class="grid gap-2">
          <Label>Ответственный</Label>
          <Select v-model="responsible">
            <SelectTrigger :disabled="submitting">
              <SelectValue placeholder="Не выбрано" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in responsibleOptions" :key="r" :value="r">
                {{ r }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="fieldErrors.responsible" class="text-sm text-destructive">
            {{ fieldErrors.responsible }}
          </p>
        </div>

        <!-- Готовность -->
        <div class="grid gap-2">
          <Label>Готовность</Label>
          <Select v-model="readiness">
            <SelectTrigger :disabled="submitting">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="READINESS_NONE">—</SelectItem>
              <SelectItem v-for="r in READINESS" :key="r" :value="r">
                {{ r }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p
          v-if="error && Object.keys(fieldErrors).length === 0"
          class="text-sm text-destructive"
        >
          {{ error }}
        </p>

        <DialogFooter class="gap-2">
          <Button type="button" variant="ghost" :disabled="submitting" @click="close">
            Отмена
          </Button>
          <Button type="submit" :disabled="submitting">
            {{ submitting ? 'Сохранение…' : 'Сохранить' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
