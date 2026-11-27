<script setup lang="ts">
import { ref, computed, watch, onUnmounted, provide } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { toast } from 'vue-sonner'
import { today, getLocalTimeZone } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import { bookingSchema, ddmmyyyyToIso, DEFAULT_CAR_CLASS } from '@detailing-admin/shared'
import type { BookingApiResult, CarClass } from '@detailing-admin/shared'
import { submitBooking } from '@/lib/api'
import { usePricelistQuery } from '@/lib/queries'
import { calToDdmmyyyy, parseDdmmyyyyToCal } from '@/lib/date'
import { CAR_SUGGESTIONS } from '@/lib/car-suggestions'
import { maskLicensePlate } from '@/lib/license-plate'
import {
  BOOKING_DRAFT_KEY,
  bookingDraftSchema,
  isMeaningfulBookingDraft,
  type BookingDraft,
} from '@/lib/booking-draft'
import {
  pickRandom,
  pickRandomMasters,
  randomDigits,
  randomPlate,
  TEST_NAMES,
  TEST_NOTES,
} from '@/lib/test-fill'
import {
  formatServiceCell,
  formatAmountFormula,
  type ServiceBreakdownRow,
} from '@/lib/service-breakdown'
import { usePhoneInput, formatPastedPhone } from '@/composables/use-phone-input'
import { useClientLookup } from '@/composables/use-client-lookup'
import { useDaysOffWarning } from '@/composables/use-days-off-warning'
import { useMasterOptions } from '@/composables/use-master-options'
import { useDiscount } from '@/composables/use-discount'
import { useFormDraft } from '@/composables/use-form-draft'
import { TIME_PRESETS, useBookingDates } from '@/composables/use-booking-dates'
import { useBookingAmount } from '@/composables/use-booking-amount'
import type { Car } from '@/lib/clients-api'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FORM_SHOW_ERRORS_KEY } from '@/components/ui/form/injectionKeys'
import BookingUnavailableBanner, {
  type UnavailableBanner,
} from './booking-form/BookingUnavailableBanner.vue'
import BookingDateTimeCard from './booking-form/BookingDateTimeCard.vue'
import BookingClientCard from './booking-form/BookingClientCard.vue'
import BookingWorkCard from './booking-form/BookingWorkCard.vue'
import BookingPaymentCard from './booking-form/BookingPaymentCard.vue'
import BookingStaffCard from './booking-form/BookingStaffCard.vue'

// Набор полей формы для сужения путей Zod-ошибок до литерального union без
// приведения типа. `Record<BookingField, true>` позволяет сужать через `in`.
type BookingField =
  | 'dateFrom'
  | 'dateTo'
  | 'time'
  | 'timeTo'
  | 'name'
  | 'phone'
  | 'car'
  | 'plate'
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
  plate: true,
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

const {
  forMaster: mastersForMaster,
  forResponsible: mastersForResponsible,
  warning: mastersWarning,
} = useMasterOptions()

// ── Ключ идемпотентности: один на все повторы, перегенерируется после успеха ───
const idempotencyKey = ref(crypto.randomUUID())

// Скрываем подписи ошибок «Invalid» / regex, пока пользователь реально не попробует
// отправить форму, иначе пустая исходная форма мелькает красным при монтировании.
const submitAttempted = ref(false)
provide(FORM_SHOW_ERRORS_KEY, submitAttempted)

const unavailableBanner = ref<UnavailableBanner | null>(null)

// Изначально пустое, чтобы был виден плейсхолдер; ввод '+', '7' или '8' первым
// символом автоматически разворачивается в префикс +7.
const phone = usePhoneInput()
const { phoneRaw, effectivePhone, resetPhone } = phone
// ── Автозаполнение клиента (поиск по полному телефону) ───────────────────────
// Читает Postgres через поиск по точному телефону; строго дополняет форму и молчит
// при ошибке — никогда не блокирует отправку записи. Сводка приходит вместе с
// совпадением, а то, что роли видеть нельзя, сервер не отдает.
const {
  matchedClient,
  matchedClientSummary,
  isLoading: clientLookupLoading,
} = useClientLookup(phoneRaw)

// Показываем спиннер с задержкой, чтобы быстрый/закэшированный поиск (<200 мс) не
// мелькал им — состояние «ищем» видно только при реально медленном запросе.
const showLookupSpinner = ref(false)
let lookupSpinnerTimer: ReturnType<typeof setTimeout> | undefined
watch(clientLookupLoading, (loading) => {
  clearTimeout(lookupSpinnerTimer)
  if (loading) lookupSpinnerTimer = setTimeout(() => (showLookupSpinner.value = true), 200)
  else showLookupSpinner.value = false
})
onUnmounted(() => clearTimeout(lookupSpinnerTimer))

const licensePlate = ref('')

// Последняя разбивка по услугам из пикера — при отправке попадает в ячейку «Услуга»
// таблицы (само поле формы остается простым CSV из названий).
const serviceBreakdown = ref<ServiceBreakdownRow[]>([])

// ── Форма ─────────────────────────────────────────────────────────────────────
// Необязательным полям «строка или undefined» нужно расширить тип с литерала
// `undefined`, чтобы vee-validate принимал последующие вызовы
// `setFieldValue('dateTo', '04.06.2026')`. То же для `amount`, который переходит
// из `''` в распарсенное число.
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
  master: string[]
  responsible: string | undefined
  carClass: CarClass
}

function emptyFormValues(date: DateValue): BookingFormInitial {
  return {
    dateFrom: calToDdmmyyyy(date),
    dateTo: undefined,
    time: '',
    timeTo: undefined,
    name: '',
    phone: '',
    car: '',
    service: '',
    note: '',
    amount: '',
    master: [],
    responsible: undefined,
    carClass: DEFAULT_CAR_CLASS,
  }
}

const { handleSubmit, setFieldValue, setFieldError, resetForm, validate, values, isSubmitting } =
  useForm({
    validationSchema: toTypedSchema(bookingSchema),
    initialValues: emptyFormValues(today(getLocalTimeZone())),
  })

const dates = useBookingDates((field, value) => setFieldValue(field, value))
const amount = useBookingAmount((value) => setFieldValue('amount', value))
const discount = useDiscount(amount.baseAmount)

// Поля дат — текст, который вводят посимвольно: пока строка неполная, предупреждать не о чем.
// Длина важна: `01.12.202` парсится как 202 год и дал бы запрос, который API отклонит.
function safeIso(ddmmyyyy: string | undefined): string | null {
  if (ddmmyyyy?.length !== 10) return null
  try {
    return ddmmyyyyToIso(ddmmyyyy)
  } catch {
    return null
  }
}
// После useForm: запрос графика сразу читает `values`, а раньше это ошибка TDZ.
const daysOff = useDaysOffWarning(
  computed(() => safeIso(values.dateFrom)),
  computed(() => safeIso(values.dateTo)),
  computed(() => values.master ?? []),
)

// Поле телефона привязано к сырой строке и живет вне FormField (см. F7), поэтому
// vee-validate не видит нажатий клавиш, и его ошибка «Укажите номер телефона»
// оставалась висеть после неудачной отправки. Зеркалим действующее значение в поле
// формы при каждом изменении (setFieldValue по умолчанию валидирует), чтобы
// ошибка исчезала сразу, как только введен номер.
watch(phoneRaw, () => {
  setFieldValue('phone', effectivePhone())
})

// При совпадении перезаписываем имя и первую машину клиента сохраненными значениями
// (то, что ввел оператор или восстановил черновик, заменяется). Защита только от
// затирания пустым: имя пропускаем, если у клиента его нет, машину — если у клиента
// нет машин. Если машин несколько, остальные доступны чипами в карточке клиента.
watch(matchedClient, (c) => {
  if (!c) return
  if (c.name.trim()) setFieldValue('name', c.name)
  const first = c.cars[0]
  if (first) selectClientCar(first)
})

// Госномер заново маскируется, чтобы привести возможно неканоничное сохраненное
// значение к каноничному виду.
function selectClientCar(car: Car) {
  setFieldValue('car', car.makeModel)
  licensePlate.value = maskLicensePlate(car.plate)
}

function onServiceBreakdown(rows: ServiceBreakdownRow[]) {
  serviceBreakdown.value = rows
}

// ── Отправка ──────────────────────────────────────────────────────────────────
function toastSaveError() {
  toast.error('Ошибка при сохранении', {
    action: { label: 'Повторить', onClick: () => void onSubmit() },
  })
}

const handleValidatedSubmit = handleSubmit(async (values) => {
  unavailableBanner.value = null
  const plate = licensePlate.value.trim()
  const payload = { ...values, plate: plate || undefined }
  // В ячейку «Услуга» идет разбивка по категориям (только названия); поле формы
  // остается простым CSV из названий для восстановления черновика.
  if (serviceBreakdown.value.length > 0) {
    payload.service = formatServiceCell(serviceBreakdown.value)
    payload.services = serviceBreakdown.value
    // «Сумма» несет арифметику, из которой сложился итог. `values.amount` — база
    // до скидки; формула сама вычитает скидку.
    const base = typeof values.amount === 'number' ? values.amount : 0
    payload.amountFormula = formatAmountFormula(serviceBreakdown.value, base, discount.amount.value)
  }
  // Скидка применяется при отправке: в таблицу пишется итог со скидкой, а сама
  // скидка сохраняется строкой в примечании (отдельной колонки нет).
  if (discount.hasDiscount.value) {
    payload.amount = discount.finalAmount.value
    payload.discount = discount.amount.value
    payload.note = [values.note?.trim(), discount.noteLine()].filter(Boolean).join('\n')
  }
  let result: BookingApiResult
  try {
    result = await submitBooking(payload, idempotencyKey.value)
  } catch {
    toastSaveError()
    return
  }

  if (result.ok) {
    toast.success('Запись сохранена')
    idempotencyKey.value = crypto.randomUUID()
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
    toastSaveError()
  }
})

async function onSubmit() {
  submitAttempted.value = true
  setFieldValue('phone', effectivePhone())
  // Показываем ошибки всех полей сразу — один handleSubmit не передает ошибки
  // схемы зарегистрированным FormField, которых ни разу не касались.
  await validate()
  await handleValidatedSubmit()
}

// Общий сброс и для кнопки очистки, и после отправки.
function resetFormState() {
  const fresh = today(getLocalTimeZone())
  resetForm({ values: emptyFormValues(fresh) })
  resetPhone()
  licensePlate.value = ''
  amount.reset()
  serviceBreakdown.value = []
  discount.reset()
  dates.reset(fresh)
  submitAttempted.value = false
}

function clearForm() {
  resetFormState()
  idempotencyKey.value = crypto.randomUUID()
  unavailableBanner.value = null
  clearDraft()
}

// ── Сохранение черновика (localStorage) ──────────────────────────────────────
function draftSnapshot(): BookingDraft {
  return {
    dateFromText: dates.dateFromText.value,
    dateToText: dates.dateToText.value,
    timeValue: dates.timeValue.value,
    timeToValue: dates.timeToValue.value,
    isRangeMode: dates.isRangeMode.value,
    name: values.name ?? '',
    phoneRaw: phoneRaw.value,
    car: values.car ?? '',
    licensePlate: licensePlate.value,
    service: values.service ?? '',
    note: values.note ?? '',
    amountRaw: amount.amountRaw.value,
    discountRaw: discount.raw.value,
    discountUnit: discount.unit.value,
    master: values.master,
    responsible: values.responsible,
    carClass: values.carClass,
  }
}

function restoreDraft(d: BookingDraft) {
  if (d.dateFromText) {
    dates.dateFromText.value = d.dateFromText
    const parsed = parseDdmmyyyyToCal(d.dateFromText)
    if (parsed) dates.dateFromCal.value = parsed
    setFieldValue('dateFrom', d.dateFromText)
  }
  if (d.dateToText) {
    dates.dateToText.value = d.dateToText
    const parsed = parseDdmmyyyyToCal(d.dateToText)
    if (parsed) dates.dateToCal.value = parsed
  }
  if (d.isRangeMode) {
    dates.isRangeMode.value = true
    setFieldValue('dateTo', d.dateToText)
    if (d.timeToValue) {
      dates.timeToValue.value = d.timeToValue
      setFieldValue('timeTo', d.timeToValue)
    }
  }
  if (d.timeValue) {
    dates.timeValue.value = d.timeValue
    setFieldValue('time', d.timeValue)
  }
  if (d.name) setFieldValue('name', d.name)
  if (d.phoneRaw) phoneRaw.value = d.phoneRaw
  if (d.car) setFieldValue('car', d.car)
  if (d.licensePlate) licensePlate.value = d.licensePlate
  if (d.service) setFieldValue('service', d.service)
  if (d.note) setFieldValue('note', d.note)
  if (d.amountRaw) amount.restore(d.amountRaw)
  if (d.discountUnit) discount.unit.value = d.discountUnit
  if (d.discountRaw) discount.raw.value = d.discountRaw
  // Старые черновики (до мультимастеров) хранили `master` одной строкой; наивный
  // `.trim()` здесь упал бы на новой форме-массиве, и весь черновик молча потерялся бы.
  if (Array.isArray(d.master)) {
    if (d.master.length > 0) setFieldValue('master', d.master)
  } else if (typeof d.master === 'string' && d.master.trim()) {
    setFieldValue('master', [d.master])
  }
  if (d.responsible && d.responsible.trim()) setFieldValue('responsible', d.responsible)
  if (d.carClass) setFieldValue('carClass', d.carClass)
}

const { clearDraft } = useFormDraft({
  key: BOOKING_DRAFT_KEY,
  schema: bookingDraftSchema,
  snapshot: draftSnapshot,
  isMeaningful: isMeaningfulBookingDraft,
  restore: restoreDraft,
  sources: [
    dates.dateFromText,
    dates.dateToText,
    dates.timeValue,
    dates.timeToValue,
    dates.isRangeMode,
    phoneRaw,
    licensePlate,
    amount.amountRaw,
    discount.raw,
    discount.unit,
    () => values.name,
    () => values.car,
    () => values.service,
    () => values.note,
    () => values.master,
    () => values.responsible,
    () => values.carClass,
  ],
})

// ── Тестовое заполнение (Ctrl+Shift+X) ───────────────────────────────────────
// Быстро набивает форму правдоподобными случайными данными для ручного
// тестирования. Услугу берем из уже загруженного прайс-листа — тогда «Сумма»
// пересчитается сама через ServicePicker; иначе выставляем сумму вручную.
const { data: pricelistData } = usePricelistQuery()

function fillTestData() {
  dates.pickDay(pickRandom([0, 1, 2]))
  dates.pickTime(pickRandom(TIME_PRESETS))

  setFieldValue('name', pickRandom(TEST_NAMES))
  phoneRaw.value = formatPastedPhone(`9${randomDigits(9)}`)
  setFieldValue('car', pickRandom(CAR_SUGGESTIONS))
  licensePlate.value = randomPlate()
  setFieldValue('note', pickRandom(TEST_NOTES))
  setFieldValue('master', pickRandomMasters(mastersForMaster.value, pickRandom([1, 2])))
  setFieldValue('responsible', pickRandom(mastersForResponsible.value))

  const r = pricelistData.value
  const allServices = r?.ok ? r.sections.flatMap((s) => s.services) : []
  if (allServices.length > 0) {
    // ServicePicker слушает modelValue: подхватит выбор и сам эмитнет «Сумму».
    setFieldValue('service', pickRandom(allServices).name)
  } else {
    amount.setAmount((Math.floor(Math.random() * 40) + 5) * 500)
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
</script>

<template>
  <div class="flex-1 bg-muted/30">
    <BookingUnavailableBanner :banner="unavailableBanner" />

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
        <BookingDateTimeCard :dates="dates" />
        <BookingClientCard
          v-model:plate="licensePlate"
          :phone="phone"
          :matched-client="matchedClient"
          :matched-client-summary="matchedClientSummary"
          :show-lookup-spinner="showLookupSpinner"
          @select-car="selectClientCar"
        />
        <BookingWorkCard @total="amount.onServicesTotal" @breakdown="onServiceBreakdown" />
        <BookingPaymentCard :amount="amount" :discount="discount" />
        <BookingStaffCard
          :master-options="mastersForMaster"
          :responsible-options="mastersForResponsible"
          :masters-warning="mastersWarning"
          :days-off="daysOff"
        />
      </div>
    </form>

    <!-- Липкая панель отправки (с учетом safe-area) -->
    <div
      class="fixed bottom-0 left-0 right-0 md:left-64 px-4 py-4 bg-background border-t border-border pb-safe"
    >
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
