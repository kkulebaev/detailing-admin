<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Calendar as CalendarIcon, ListChecks, TriangleAlert, X } from '@lucide/vue'
import type { DateValue } from 'reka-ui'
import {
  bookingSchema,
  DEFAULT_CAR_CLASS,
  MAX_MASTERS,
  READINESS,
  type BookingRow,
  type BookingServiceLine,
  type CarClass,
} from '@detailing-admin/shared'
import { updateBooking, type PatchApiBookingsIdBody } from '@/lib/bookings-api'
import { calToDdmmyyyy, isoToCal } from '@/lib/date'
import { groupThousands } from '@/lib/number-mask'
import { formatAmount } from '@/lib/money'
import { amountDigits, maskTimeText, writeMasked } from '@/lib/input-masks'
import { useMasterOptions } from '@/composables/use-master-options'
import {
  formatAmountFormula,
  formatServiceCell,
  type ServiceBreakdownRow,
} from '@/lib/service-breakdown'
import { formatPastedPhone, usePhoneInput } from '@/composables/use-phone-input'
import { useDaysOffWarning } from '@/composables/use-days-off-warning'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import MasterMultiSelect from './MasterMultiSelect.vue'
import ServicePicker from './ServicePicker.vue'

const props = defineProps<{
  open: boolean
  booking: BookingRow | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

// Select из reka-ui не принимает пустое значение, поэтому опция «нет статуса» держится
// на значении-маркере, которое сборщик payload превращает обратно в '' (пустая
// готовность по схеме).
const READINESS_NONE = '__none__'

const CAR_CLASS_OPTIONS = [
  { value: '1', label: 'I' },
  { value: '2', label: 'II' },
  { value: '3', label: 'III' },
  { value: '4', label: 'IV' },
] as const

// shallowRef сохраняет #private-поле CalendarDate (UnwrapRef из Vue его срезает).
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
const master = ref<string[]>([])
const responsible = ref<string | undefined>(undefined)
const carClass = ref<string>(String(DEFAULT_CAR_CLASS))

// ── Услуги ────────────────────────────────────────────────────────────────────
// У записи с разбивкой по прайсу услуги правятся пикером, как в форме записи; у
// старой записи со свободным текстом — текстом, пока не нажали «Выбрать из прайса».
const serviceMode = ref<'lines' | 'text'>('text')
// Новая ссылка на каждое открытие: пикер применяет строки заново только тогда.
const initialLines = ref<BookingServiceLine[] | null>(null)
const breakdown = ref<ServiceBreakdownRow[]>([])
// Текст услуги до перехода на прайс: показываем, чтобы было с чем сверить выбор.
const textBeforeLines = ref('')
const hadLines = ref(false)
const discount = ref(0)
const originalAmount = ref<number | null>(null)
// Пикер показывает актуальные названия из прайса и сам расставляет строки, так что
// пересобранная разбивка может отличаться от сохраненной без всякой правки. Пока
// пользователь не тронул услуги, отправляем сохраненный текст, а строки не шлем вовсе,
// и сервер их не трогает; заодно сохранение не зависит от загрузки прайса.
const servicesDirty = ref(false)

const submitting = ref(false)
const confirmDiscardOpen = ref(false)
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

const { forMaster, forResponsible } = useMasterOptions()
// Пока диалог закрыт, даты пусты, и запрос графика простаивает.
const daysOff = useDaysOffWarning(
  computed(() => (props.open ? (dateFromCal.value?.toString() ?? null) : null)),
  computed(() => dateToCal.value?.toString() ?? null),
  master,
  { skipPast: true },
)

// Добавляем текущих мастеров/ответственного записи, даже если их уже нет в
// актуальном списке, чтобы правка молча не потеряла значение, которое уже есть в строке.
const masterOptions = computed(() => {
  const base = forMaster.value
  const missing = master.value.filter((m) => !base.includes(m))
  return missing.length > 0 ? [...missing, ...base] : base
})
const responsibleOptions = computed(() => {
  const base = forResponsible.value
  const cur = responsible.value
  return cur && !base.includes(cur) ? [cur, ...base] : base
})

const currentAmount = computed(() => {
  const digits = amountDigits(amountRaw.value)
  return digits === '' ? null : parseInt(digits, 10)
})

// Сумма по выбранным услугам за вычетом сохраненной скидки; null, если считать не из чего.
const servicesAmount = computed<number | null>(() => {
  if (serviceMode.value !== 'lines' || breakdown.value.length === 0) return null
  const subtotal = breakdown.value.reduce((acc, r) => acc + r.price * r.quantity, 0)
  return Math.max(0, subtotal - discount.value)
})

const amountChanged = computed(
  () => originalAmount.value !== null && currentAmount.value !== originalAmount.value,
)
const amountOffServices = computed(
  () => servicesAmount.value !== null && currentAmount.value !== servicesAmount.value,
)

function setAmount(value: number) {
  amountRaw.value = groupThousands(String(value))
}

// Пикер эмитит итог только на действия пользователя (выбор, цена, количество, класс),
// поэтому открытие записи сумму не трогает, а любая правка услуг ее пересчитывает.
function onServicesTotal(total: number | null) {
  servicesDirty.value = true
  if (total === null) return
  setAmount(Math.max(0, total - discount.value))
}

function switchToPricelist() {
  textBeforeLines.value = service.value
  initialLines.value = []
  breakdown.value = []
  serviceMode.value = 'lines'
}

function switchToText() {
  servicesDirty.value = false
  service.value = textBeforeLines.value
  if (originalAmount.value !== null) setAmount(originalAmount.value)
  initialLines.value = null
  breakdown.value = []
  serviceMode.value = 'text'
}

// Снимок полей в момент открытия: несохраненной правкой считается любое отличие от него.
// Строки пикера в снимок не входят, потому что пикер пересобирает их сам при открытии;
// правку услуг ловит servicesDirty, который ставят только действия пользователя.
function formSnapshot(): string {
  return JSON.stringify([
    dateFromCal.value?.toString() ?? null,
    dateToCal.value?.toString() ?? null,
    timeValue.value,
    timeToValue.value,
    name.value,
    phoneRaw.value,
    car.value,
    service.value,
    note.value,
    amountRaw.value,
    readiness.value,
    master.value,
    responsible.value ?? null,
    carClass.value,
    serviceMode.value,
  ])
}
const initialSnapshot = ref('')
const isDirty = computed(
  () => props.open && (servicesDirty.value || formSnapshot() !== initialSnapshot.value),
)

watch(
  () => props.open,
  (v) => {
    confirmDiscardOpen.value = false
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
    amountRaw.value = b?.amount != null ? groupThousands(String(b.amount)) : ''
    readiness.value = b && READINESS.some((r) => r === b.readiness) ? b.readiness : READINESS_NONE
    master.value = b?.master ?? []
    responsible.value = b?.responsible ? b.responsible : undefined
    carClass.value = b ? String(b.carClass) : String(DEFAULT_CAR_CLASS)
    const lines = b?.services ?? []
    hadLines.value = lines.length > 0
    serviceMode.value = hadLines.value ? 'lines' : 'text'
    initialLines.value = hadLines.value ? lines.map((l) => ({ ...l })) : null
    breakdown.value = []
    servicesDirty.value = false
    textBeforeLines.value = ''
    discount.value = b?.discount ?? 0
    originalAmount.value = b?.amount ?? null
    initialSnapshot.value = formSnapshot()
  },
)

function onTimeInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  timeValue.value = masked
  writeMasked(target, masked)
}

function onTimeToInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  timeToValue.value = masked
  writeMasked(target, masked)
}

function onAmountInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = groupThousands(amountDigits(target.value))
  amountRaw.value = masked
  writeMasked(target, masked)
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
  if (isDirty.value) {
    confirmDiscardOpen.value = true
    return
  }
  emit('update:open', false)
}

function discardAndClose() {
  confirmDiscardOpen.value = false
  emit('update:open', false)
}

function onDialogOpenChange(v: boolean) {
  if (v) emit('update:open', true)
  else close()
}

function firstIssuePerField(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const mapped: Record<string, string> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '_')
    if (!(key in mapped)) mapped[key] = issue.message
  }
  return mapped
}

async function submit() {
  if (!props.booking) return
  fieldErrors.value = {}
  error.value = null

  const digits = amountDigits(amountRaw.value)
  const lines = serviceMode.value === 'lines' && servicesDirty.value ? breakdown.value : undefined
  const rawInput = {
    dateFrom: dateFromCal.value ? calToDdmmyyyy(dateFromCal.value) : '',
    dateTo: dateToCal.value ? calToDdmmyyyy(dateToCal.value) : undefined,
    time: timeValue.value.trim(),
    timeTo: timeToValue.value.trim() ? timeToValue.value.trim() : undefined,
    name: name.value.trim(),
    phone: effectivePhone(),
    car: car.value.trim(),
    service: lines ? formatServiceCell(lines) : service.value.trim(),
    services: lines,
    note: note.value,
    amount: digits === '' ? '' : parseInt(digits, 10),
    readiness: readiness.value === READINESS_NONE ? '' : readiness.value,
    master: master.value,
    responsible: responsible.value ?? '',
    carClass: Number(carClass.value),
  }

  const parsed = bookingSchema.safeParse(rawInput)
  if (!parsed.success) {
    fieldErrors.value = firstIssuePerField(parsed.error.issues)
    error.value = parsed.error.issues[0]?.message ?? 'Проверьте заполнение полей'
    return
  }

  // transform повторно выполняется на бэкенде; отправляем входную форму данных. Формулу шлем, только когда есть строки услуг: без них ее не из чего собрать,
  // и сервер сам решает, оставить ли прежнюю.
  const amountFormula = parsed.data.services
    ? formatAmountFormula(parsed.data.services, parsed.data.amount + discount.value, discount.value)
    : undefined
  const payload: PatchApiBookingsIdBody = {
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    time: parsed.data.time,
    timeTo: parsed.data.timeTo,
    name: parsed.data.name,
    phone: parsed.data.phone,
    car: parsed.data.car,
    service: parsed.data.service,
    services: parsed.data.services,
    note: parsed.data.note,
    amount: parsed.data.amount,
    amountFormula,
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
      fieldErrors.value = firstIssuePerField(result.issues)
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
  <Dialog :open="open" @update:open="onDialogOpenChange">
    <DialogContent class="max-h-svh overflow-y-auto">
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
          <Label
            >Окончание <span class="text-muted-foreground font-normal">(необязательно)</span></Label
          >
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

        <!-- Класс кузова: у пикера свой переключатель класса, как в форме записи -->
        <div v-if="serviceMode === 'text'" class="grid gap-2">
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
          <div class="flex items-center justify-between gap-2">
            <Label :for="serviceMode === 'text' ? 'booking-service' : undefined">Услуга</Label>
            <Button
              v-if="serviceMode === 'text'"
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 gap-1.5 px-2 text-xs"
              :disabled="submitting"
              @click="switchToPricelist"
            >
              <ListChecks class="size-3.5" />
              Выбрать из прайса
            </Button>
            <Button
              v-else-if="!hadLines"
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              :disabled="submitting"
              @click="switchToText"
            >
              Вернуть текст
            </Button>
          </div>
          <Textarea
            v-if="serviceMode === 'text'"
            id="booking-service"
            v-model="service"
            rows="3"
            class="[field-sizing:content]"
            :disabled="submitting"
            maxlength="2000"
          />
          <template v-else>
            <ServicePicker
              :car-class="Number(carClass) as CarClass"
              :initial-lines="initialLines"
              :invalid="!!fieldErrors.service || !!fieldErrors.services"
              @update:car-class="(c: CarClass) => (carClass = String(c))"
              @update:total="onServicesTotal"
              @update:breakdown="(rows: ServiceBreakdownRow[]) => (breakdown = rows)"
            />
            <p v-if="textBeforeLines" class="text-xs text-muted-foreground whitespace-pre-line">
              Было: {{ textBeforeLines }}
            </p>
          </template>
          <p v-if="fieldErrors.service" class="text-sm text-destructive">
            {{ fieldErrors.service }}
          </p>
          <p v-if="fieldErrors.services" class="text-sm text-destructive">
            {{ fieldErrors.services }}
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
          <p
            v-if="amountChanged"
            class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-600 dark:text-amber-500"
          >
            <TriangleAlert class="size-3.5 shrink-0" />
            <span>Сумма изменилась: было {{ formatAmount(originalAmount ?? 0) }} ₽</span>
            <button
              type="button"
              class="underline underline-offset-2 hover:no-underline"
              :disabled="submitting"
              @click="setAmount(originalAmount ?? 0)"
            >
              вернуть
            </button>
          </p>
          <p
            v-if="amountOffServices"
            class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <span>По услугам: {{ formatAmount(servicesAmount ?? 0) }} ₽</span>
            <button
              type="button"
              class="underline underline-offset-2 hover:no-underline"
              :disabled="submitting"
              @click="setAmount(servicesAmount ?? 0)"
            >
              пересчитать
            </button>
          </p>
          <p v-if="serviceMode === 'lines' && discount > 0" class="text-xs text-muted-foreground">
            Скидка {{ formatAmount(discount) }} ₽ вычитается из суммы по услугам
          </p>
          <p v-if="fieldErrors.amount" class="text-sm text-destructive">
            {{ fieldErrors.amount }}
          </p>
        </div>

        <!-- Мастер -->
        <div class="grid gap-2">
          <Label>Мастер</Label>
          <MasterMultiSelect
            v-model="master"
            :options="masterOptions"
            :max="MAX_MASTERS"
            :disabled="submitting"
          />
          <p v-if="fieldErrors.master" class="text-sm text-destructive">
            {{ fieldErrors.master }}
          </p>
          <Alert v-if="daysOff.length > 0" variant="destructive">
            <TriangleAlert />
            <AlertTitle>Выходной по графику</AlertTitle>
            <AlertDescription>
              <p v-for="line in daysOff" :key="line">{{ line }}</p>
            </AlertDescription>
          </Alert>
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

        <p v-if="error && Object.keys(fieldErrors).length === 0" class="text-sm text-destructive">
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

  <AlertDialog v-model:open="confirmDiscardOpen">
    <!-- Уже окна редактирования, чтобы не сливаться с ним по краям; в узком окне кнопки
         не помещаются в ряд, поэтому стоят столбиком и на десктопе. -->
    <AlertDialogContent class="sm:max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle>Изменения не сохранены</AlertDialogTitle>
        <AlertDialogDescription>
          Если закрыть окно, внесенные правки в записи пропадут
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter class="sm:flex-col-reverse">
        <!-- h-11 дает на телефоне тап не меньше 44 px: стандартные 36 px легко промахнуть
             пальцем рядом с опасной кнопкой. -->
        <AlertDialogCancel class="h-11 sm:h-9">Продолжить редактирование</AlertDialogCancel>
        <Button variant="destructive" class="h-11 sm:h-9" @click="discardAndClose">
          Закрыть без сохранения
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
