<script setup lang="ts">
import { ref, shallowRef, computed, watch, onUnmounted, provide } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { toast } from 'vue-sonner'
import { Calendar as CalendarIcon, Pencil, TriangleAlert, User } from '@lucide/vue'
import { today, getLocalTimeZone } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import {
  bookingSchema,
  ddmmyyyyToIso,
  DEFAULT_CAR_CLASS,
  MAX_MASTERS,
} from '@detailing-admin/shared'
import type { BookingApiResult, CarClass, MissedBookings } from '@detailing-admin/shared'
import { submitBooking } from '@/lib/api'
import { usePricelistQuery } from '@/lib/queries'
import { useAuthStore } from '@/stores/auth'
import { calToDdmmyyyy, isoToDdmmyyyy, parseDdmmyyyyToCal } from '@/lib/date'
import { CAR_SUGGESTIONS } from '@/lib/car-suggestions'
import { formatAmount } from '@/lib/money'
import { groupThousands, maskThousands } from '@/lib/number-mask'
import { maskLicensePlate } from '@/lib/license-plate'
import {
  amountDigits,
  isComposingInput,
  maskCar,
  maskDateText,
  maskName,
  maskTimeText,
  writeMasked,
} from '@/lib/input-masks'
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
import { useCarSuggestions } from '@/composables/use-car-suggestions'
import { useFormDraft } from '@/composables/use-form-draft'
import type { Car } from '@/lib/clients-api'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Calendar } from '@/components/ui/calendar'
import ServicePicker from './ServicePicker.vue'
import MasterMultiSelect from './MasterMultiSelect.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { FORM_SHOW_ERRORS_KEY } from '@/components/ui/form/injectionKeys'

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

// ── Состояние календаря ───────────────────────────────────────────────────────
const localTz = getLocalTimeZone()
const todayVal = today(localTz)
// shallowRef сохраняет #private-поле CalendarDate (UnwrapRef из Vue его срезает)
const dateFromCal = shallowRef<DateValue>(todayVal)
const dateToCal = shallowRef<DateValue>(todayVal)

// Режим диапазона (заменяет старый Switch). Когда он включен, появляется вторая
// строка «Окончание работ» со своими полями даты и времени.
const isRangeMode = ref(false)

const dateFromOpen = ref(false)
const dateToOpen = ref(false)

// Дата/время живут в собственных ref, чтобы пользователь мог печатать прямо в
// текстовые поля с маской. Поповер календаря — лишь альтернативный ввод, который
// пишет обратно в эти ref.
const dateFromText = ref(calToDdmmyyyy(todayVal))
const dateToText = ref(calToDdmmyyyy(todayVal))
const timeValue = ref('')
const timeToValue = ref('')

// Скрываем подписи ошибок «Invalid» / regex, пока пользователь реально не попробует
// отправить форму, иначе пустая исходная форма мелькает красным при монтировании.
const submitAttempted = ref(false)
provide(FORM_SHOW_ERRORS_KEY, submitAttempted)

function sameDay(a: DateValue | undefined, b: DateValue | undefined): boolean {
  if (!a || !b) return false
  return a.year === b.year && a.month === b.month && a.day === b.day
}

// ── Баннер недоступности (не закрывается) ────────────────────────────────────
type UnavailableBanner =
  | {
      kind: 'headers_mismatch'
      column_index: number
      expected: string
      observed: string
    }
  | { kind: 'not_configured'; message: string }
const unavailableBanner = ref<UnavailableBanner | null>(null)

// ── Поле телефона (сырое отображаемое значение + обработчики) ───────────────
// Изначально пустое, чтобы был виден плейсхолдер; ввод '+', '7' или '8' первым
// символом автоматически разворачивается в префикс +7.
const {
  phoneRaw,
  effectivePhone,
  onPhoneInput,
  onPhoneKeydown,
  onPhonePaste,
  onClickPastePhone,
  resetPhone,
} = usePhoneInput()
// ── Автозаполнение клиента (поиск по полному телефону) ───────────────────────
// Читает Postgres через поиск по точному телефону; строго дополняет форму и молчит
// при ошибке — никогда не блокирует отправку записи. Сводка приходит вместе с
// совпадением, а то, что роли видеть нельзя, сервер не отдает.
const {
  matchedClient,
  matchedClientSummary,
  isLoading: clientLookupLoading,
} = useClientLookup(phoneRaw)
const auth = useAuthStore()

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

function formatMissed(m: MissedBookings): string {
  const parts: string[] = []
  if (m.cancelled > 0) parts.push(`Отменял запись: ${m.cancelled}`)
  if (m.noShow > 0) parts.push(`Не приезжал: ${m.noShow}`)
  return `${parts.join(' · ')}. Последний раз — ${isoToDdmmyyyy(m.lastDate)}`
}

// ── Госномер — отправляется отдельным полем `plate`; сервер склеивает его
// с `car` (joinCar) для колонки таблицы и зеркала bookings. ────────
const licensePlate = ref('')
// ── Отображаемое значение суммы (с разделителями тысяч) ──────────────────────
const amountRaw = ref('')

// Последняя сумма цен услуг из пикера (null, если ничего не выбрано).
// Хранится, чтобы «Сумма» могла пометить, что ее вручную увели от этого итога.
const servicesTotal = ref<number | null>(null)

// Последняя разбивка по услугам из пикера — при отправке попадает в ячейку «Услуга»
// таблицы (само поле формы остается простым CSV из названий).
const serviceBreakdown = ref<ServiceBreakdownRow[]>([])

const baseAmount = computed(() => {
  const digits = amountDigits(amountRaw.value)
  return digits === '' ? 0 : parseInt(digits, 10)
})

// Разница со знаком между «Сумма» и итогом по услугам (текущая − итог).
// null, когда сравнивать не с чем. Пустая сумма считается за 0.
const amountDelta = computed<number | null>(() =>
  servicesTotal.value === null ? null : baseAmount.value - servicesTotal.value,
)

// True, когда услуги выбраны, а «Сумма» уже не равна их итогу — т. е. оператор
// ввел свое значение (или воспользовался +пресетом).
const amountOverridden = computed(() => amountDelta.value !== null && amountDelta.value !== 0)

// «+2 500 ₽» / «−2 000 ₽» — насколько ручная сумма отличается от итога по услугам.
const amountDeltaLabel = computed(() => {
  const d = amountDelta.value ?? 0
  const sign = d > 0 ? '+' : '−'
  return `${sign}${formatAmount(Math.abs(d))} ₽`
})

function setAmount(value: number) {
  amountRaw.value = groupThousands(String(value))
  setFieldValue('amount', value)
}

function resetAmountToServices() {
  if (servicesTotal.value === null) return
  setAmount(servicesTotal.value)
}

const {
  raw: discountRaw,
  unit: discountUnit,
  amount: discountAmount,
  finalAmount,
  hasDiscount,
  onInput: onDiscountInput,
  setUnit: setDiscountUnit,
  noteLine: discountNoteLine,
  reset: resetDiscount,
} = useDiscount(baseAmount)

// ── Пресеты быстрого выбора ──────────────────────────────────────────────────
const AMOUNT_PRESETS = [1000, 5000, 10000, 50000] as const

// Часы работы детейлинга: 10:00–18:30 слотами по 30 минут.
const TIME_PRESETS = [
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
] as const

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
  initialValues: emptyFormValues(todayVal),
})

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
// нет машин. Если машин несколько, остальные доступны чипами (см. шаблон) для
// переключения «Марка и модель».
watch(matchedClient, (c) => {
  if (!c) return
  if (c.name.trim()) setFieldValue('name', c.name)
  const first = c.cars[0]
  if (first) selectClientCar(first)
})

// Выбор одной из машин найденного клиента: заполняет «Марка и модель» и госномер.
// `plate` — не поле vee-validate (это отдельный ref `licensePlate`, который
// собирается в payload при отправке), поэтому он ставится прямо в ref и заново
// маскируется, чтобы привести к каноничному виду возможно неканоничное сохраненное значение.
function selectClientCar(car: Car) {
  setFieldValue('car', car.makeModel)
  licensePlate.value = maskLicensePlate(car.plate)
}

// ── Чипы быстрого выбора даты ────────────────────────────────────────────────
function shiftedDate(days: number): DateValue {
  return todayVal.add({ days })
}

function pickDay(days: number) {
  const d = shiftedDate(days)
  isRangeMode.value = false
  dateFromCal.value = d
  dateFromText.value = calToDdmmyyyy(d)
  setFieldValue('dateFrom', calToDdmmyyyy(d))
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
  // Копируем dateFrom в dateTo, чтобы пользователь мог поправить только конец, а
  // наполовину заполненный диапазон никогда не попадал в поля формы.
  dateToCal.value = dateFromCal.value
  dateToText.value = dateFromText.value
  setFieldValue('dateTo', dateFromText.value)
}

const isTodayActive = computed(
  () => !isRangeMode.value && sameDay(dateFromCal.value, shiftedDate(0)),
)
const isTomorrowActive = computed(
  () => !isRangeMode.value && sameDay(dateFromCal.value, shiftedDate(1)),
)
const isDayAfter2Active = computed(
  () => !isRangeMode.value && sameDay(dateFromCal.value, shiftedDate(2)),
)

function pickTime(t: string) {
  timeValue.value = t
  setFieldValue('time', t)
}

function pickTimeTo(t: string) {
  timeToValue.value = t
  setFieldValue('timeTo', t)
}

// ── Подсказки машины (автодополнение) ────────────────────────────────────────
const {
  open: carPopoverOpen,
  activeIndex: carActiveIndex,
  listEl: carListEl,
  filtered: filteredCars,
  openSuggestions: openCarSuggestions,
  trackInput: trackCarInput,
  onItemPointerDown: onCarItemPointerDown,
  onItemPointerUp: onCarItemPointerUp,
  onKeydown: onCarKeydown,
} = useCarSuggestions(
  () => values.car ?? '',
  (car) => setFieldValue('car', car),
)

// ── Обработчики текстовых полей даты / времени ───────────────────────────────
function onDateFromTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskDateText(target.value)
  if (writeMasked(target, masked)) dateFromText.value = masked
  setFieldValue('dateFrom', masked)
  const parsed = parseDdmmyyyyToCal(masked)
  if (parsed) dateFromCal.value = parsed
}

function onDateToTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskDateText(target.value)
  if (writeMasked(target, masked)) dateToText.value = masked
  setFieldValue('dateTo', masked)
  const parsed = parseDdmmyyyyToCal(masked)
  if (parsed) dateToCal.value = parsed
}

function onTimeTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  if (writeMasked(target, masked)) timeValue.value = masked
  setFieldValue('time', masked)
}

function onTimeToTextInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const masked = maskTimeText(target.value)
  if (writeMasked(target, masked)) timeToValue.value = masked
  setFieldValue('timeTo', masked)
}

function onNameInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (isComposingInput(e)) {
    setFieldValue('name', target.value)
    return
  }
  const masked = maskName(target.value)
  writeMasked(target, masked)
  setFieldValue('name', masked)
}

function onCarInput(e: Event) {
  trackCarInput(e)
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (isComposingInput(e)) {
    setFieldValue('car', target.value)
    return
  }
  const masked = maskCar(target.value)
  writeMasked(target, masked)
  setFieldValue('car', masked)
}

function onLicensePlateInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (isComposingInput(e)) {
    licensePlate.value = target.value
    return
  }
  const masked = maskLicensePlate(target.value)
  if (writeMasked(target, masked)) licensePlate.value = masked
}

// ── Обработчик поля суммы ─────────────────────────────────────────────────────
function onAmountInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const caretPos = target.selectionStart ?? target.value.length
  const { value, caret } = maskThousands(target.value, caretPos)
  if (writeMasked(target, value, caret)) amountRaw.value = value
  const digits = amountDigits(value)
  const parsed: '' | number = digits === '' ? '' : parseInt(digits, 10)
  setFieldValue('amount', parsed)
}

function addAmount(delta: number) {
  setAmount(baseAmount.value + delta)
}

// Автозаполнение «Сумма» по ценам услуг из пикера. Поле остается
// редактируемым — ручное значение просто держится до следующего изменения
// выбора/цены, которое пересчитает итог.
function onServicesTotal(total: number | null) {
  servicesTotal.value = total
  if (total === null) {
    amountRaw.value = ''
    setFieldValue('amount', '')
    return
  }
  setAmount(total)
}

function onServiceBreakdown(rows: ServiceBreakdownRow[]) {
  serviceBreakdown.value = rows
}

// ── Обработчики выбора в календаре ────────────────────────────────────────────
function onDateFromSelect(date: DateValue | undefined) {
  if (!date) return
  dateFromCal.value = date
  const str = calToDdmmyyyy(date)
  dateFromText.value = str
  setFieldValue('dateFrom', str)
  dateFromOpen.value = false
}

function onDateToSelect(date: DateValue | undefined) {
  if (!date) return
  dateToCal.value = date
  const str = calToDdmmyyyy(date)
  dateToText.value = str
  setFieldValue('dateTo', str)
  dateToOpen.value = false
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
    payload.amountFormula = formatAmountFormula(serviceBreakdown.value, base, discountAmount.value)
  }
  // Скидка применяется при отправке: в таблицу пишется итог со скидкой, а сама
  // скидка сохраняется строкой в примечании (отдельной колонки нет).
  if (hasDiscount.value) {
    payload.amount = finalAmount.value
    payload.discount = discountAmount.value
    payload.note = [values.note?.trim(), discountNoteLine()].filter(Boolean).join('\n')
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
  const fresh = today(localTz)
  resetForm({ values: emptyFormValues(fresh) })
  resetPhone()
  licensePlate.value = ''
  amountRaw.value = ''
  servicesTotal.value = null
  serviceBreakdown.value = []
  resetDiscount()
  timeValue.value = ''
  timeToValue.value = ''
  dateFromText.value = calToDdmmyyyy(fresh)
  dateToText.value = calToDdmmyyyy(fresh)
  dateFromCal.value = fresh
  dateToCal.value = fresh
  isRangeMode.value = false
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
}

function restoreDraft(d: BookingDraft) {
  if (d.dateFromText) {
    dateFromText.value = d.dateFromText
    const parsed = parseDdmmyyyyToCal(d.dateFromText)
    if (parsed) dateFromCal.value = parsed
    setFieldValue('dateFrom', d.dateFromText)
  }
  if (d.dateToText) {
    dateToText.value = d.dateToText
    const parsed = parseDdmmyyyyToCal(d.dateToText)
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
    dateFromText,
    dateToText,
    timeValue,
    timeToValue,
    isRangeMode,
    phoneRaw,
    licensePlate,
    amountRaw,
    discountRaw,
    discountUnit,
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
  pickDay(pickRandom([0, 1, 2]))
  pickTime(pickRandom(TIME_PRESETS))

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
    setAmount((Math.floor(Math.random() * 40) + 5) * 500)
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
    <!-- Незакрываемый баннер недоступности -->
    <div
      v-if="unavailableBanner && unavailableBanner.kind === 'headers_mismatch'"
      class="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium"
      role="alert"
    >
      «Сервис временно недоступен: расхождение в заголовках таблицы. Столбец
      {{ unavailableBanner.column_index + 1 }}: ожидается «{{ unavailableBanner.expected }}»,
      найдено «{{ unavailableBanner.observed }}». Исправьте заголовок в таблице или EXPECTED_HEADERS
      в коде и перезапустите API.»
    </div>
    <div
      v-else-if="unavailableBanner && unavailableBanner.kind === 'not_configured'"
      class="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium"
      role="alert"
    >
      «Сервис не сконфигурирован: {{ unavailableBanner.message }}. Проверьте серверные переменные
      окружения и перезапустите API.»
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
            <!-- Чипы быстрого выбора даты -->
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
              <!-- Текстовое поле даты + иконка-триггер календаря -->
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
              <!-- Текстовое поле времени (маска HH:MM) -->
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

            <!-- Чипы быстрого выбора времени -->
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

            <p
              v-if="submitAttempted && errors.time"
              class="text-sm font-medium text-destructive mt-1"
            >
              {{ errors.time }}
            </p>

            <!-- Окончание работ — плавно раскрывается/сворачивается при переключении режима
               диапазона. Внешний grid анимирует grid-template-rows 0fr↔1fr; внутренний
               overflow-hidden обрезает содержимое во время перехода. pt-4 на самой внутренней
               обертке дает отступ над секцией диапазона в раскрытом виде и схлопывается вместе
               со строкой, когда она скрыта (без «призрачного» отступа).
               NB: у 0fr суффикс `!` (important в Tailwind v4) — без него Tailwind выводит
               grid-rows-[1fr] после grid-rows-[0fr] в порядке исходника, поэтому базовый
               класс всегда побеждает, и переход не видит изменений. -->
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
                    <p
                      v-if="submitAttempted && errors.timeTo"
                      class="text-sm font-medium text-destructive mt-1"
                    >
                      {{ errors.timeTo }}
                    </p>
                    <p
                      v-if="submitAttempted && errors.dateTo"
                      class="text-sm font-medium text-destructive mt-1"
                    >
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
              <!-- Сначала телефон: найденный номер автоматически заполняет имя ниже (фича
                 5.1), поэтому телефон открывает секцию клиента. -->
              <!-- Телефон (привязан к сырой строке с маской — намеренно вне FormField, см. F7) -->
              <div>
                <div class="mb-2 flex items-center gap-2">
                  <Label>Номер телефона</Label>
                  <!-- Спиннер, пока идет поиск по точному совпадению, чтобы пауза до
                     появления чипа (или его отсутствия) читалась как «ищем», а не как тишина. -->
                  <Spinner v-if="showLookupSpinner" class="size-4 text-muted-foreground" />
                </div>
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
                <p
                  v-if="submitAttempted && errors.phone"
                  class="text-sm font-medium text-destructive mt-1"
                >
                  {{ errors.phone }}
                </p>

                <!-- Подсказка распознанного клиента и его авто. Отдельная
                   поверхность под телефоном (не в поповере «Марка и модель»):
                   имя подставляется автоматически, авто — по тапу. -->
                <div v-if="matchedClient" class="mt-2">
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <User class="size-3.5 shrink-0" />
                    <span>
                      {{
                        matchedClient.name
                          ? `Найден клиент с именем: ${matchedClient.name}`
                          : 'Найден клиент без имени'
                      }}
                    </span>
                  </div>
                  <div
                    v-if="matchedClientSummary"
                    class="mt-1 space-y-0.5 pl-5.5 text-xs text-muted-foreground"
                  >
                    <p v-if="matchedClientSummary.visitCount > 0 && matchedClientSummary.lastVisit">
                      Визитов: {{ matchedClientSummary.visitCount }} · последний
                      {{ isoToDdmmyyyy(matchedClientSummary.lastVisit) }}
                    </p>
                    <p v-else>Завершенных визитов еще не было</p>
                    <p v-if="matchedClientSummary.totalSpent" class="tabular-nums">
                      Потрачено: {{ formatAmount(matchedClientSummary.totalSpent) }} ₽
                    </p>
                    <p
                      v-if="matchedClientSummary.lastService"
                      class="line-clamp-3 whitespace-pre-line"
                    >
                      Последнее: {{ matchedClientSummary.lastService }}
                    </p>
                    <!-- Новая вкладка: уход с формы бросил бы ее на середине ввода, а
                       закрытие карточки ведет на /clients, а не обратно сюда. -->
                    <RouterLink
                      v-if="auth.isAdmin"
                      :to="{ name: 'client-detail', params: { id: matchedClient.id } }"
                      target="_blank"
                      class="inline-block pt-0.5 font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      Открыть карточку →
                    </RouterLink>
                  </div>
                  <Alert v-if="matchedClientSummary?.missed" variant="destructive" class="mt-2">
                    <TriangleAlert />
                    <AlertTitle>Записывать только по предоплате</AlertTitle>
                    <AlertDescription>
                      {{ formatMissed(matchedClientSummary.missed) }}
                    </AlertDescription>
                  </Alert>
                </div>
              </div>

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

              <FormField v-slot="{ componentField }" name="car">
                <FormItem>
                  <FormLabel>Марка и модель</FormLabel>
                  <div class="relative">
                    <FormControl>
                      <Input
                        type="text"
                        class="h-11"
                        placeholder="Toyota Camry"
                        autocomplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        :aria-expanded="carPopoverOpen && filteredCars.length > 0"
                        data-car-input
                        v-bind="componentField"
                        @focus="openCarSuggestions"
                        @click="openCarSuggestions"
                        @input="onCarInput"
                        @keydown="onCarKeydown"
                      />
                    </FormControl>
                    <ul
                      v-if="carPopoverOpen && filteredCars.length > 0"
                      ref="carListEl"
                      data-car-suggestions
                      role="listbox"
                      class="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
                    >
                      <li
                        v-for="(car, i) in filteredCars"
                        :key="car"
                        role="option"
                        :aria-selected="i === carActiveIndex"
                        :data-active="i === carActiveIndex"
                        class="cursor-pointer px-3 py-2 text-sm data-[active=true]:bg-accent"
                        @pointerdown.prevent="onCarItemPointerDown($event, i)"
                        @pointerup="onCarItemPointerUp($event, car)"
                        @mouseenter="carActiveIndex = i"
                      >
                        {{ car }}
                      </li>
                    </ul>
                  </div>
                  <FormMessage />
                </FormItem>
              </FormField>

              <!-- Машины клиента чипами прямо под «Марка и модель» — первая подставляется
                 автоматически; чипы появляются, только если машин несколько, чтобы переключиться. -->
              <div
                v-if="matchedClient && matchedClient.cars.length > 1"
                class="-mt-2 flex flex-wrap gap-1.5"
              >
                <button
                  v-for="car in matchedClient.cars"
                  :key="car.id"
                  type="button"
                  :aria-label="`Заполнить авто ${car.makeModel}${car.plate ? ' ' + car.plate : ''}`"
                  class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors"
                  @click="selectClientCar(car)"
                >
                  {{ car.makeModel }}{{ car.plate ? ' · ' + car.plate : '' }}
                </button>
              </div>

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
              <!-- Привязано явными пропсами вместо `v-bind="componentField"`:
                 сквозные DOM-слушатели onInput/onChange из componentField
                 попадают на корневой div пикера и перезаписывали бы `service`
                 текстом любого всплывшего события (например, из полей цен). -->
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
                    <Textarea rows="3" class="[field-sizing:content]" v-bind="componentField" />
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
                +{{ formatAmount(delta) }}
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
            <p
              v-if="submitAttempted && errors.amount"
              class="text-sm font-medium text-destructive mt-1"
            >
              {{ errors.amount }}
            </p>

            <Label class="mt-4 mb-2 block">
              Скидка
              <span class="text-muted-foreground font-normal">(необязательно)</span>
            </Label>
            <div class="flex gap-2">
              <div
                class="inline-flex h-11 items-center rounded-md border border-input bg-background p-1 shrink-0"
              >
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
                <span
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                >
                  {{ discountUnit === 'pct' ? '%' : '₽' }}
                </span>
              </div>
            </div>
            <div class="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span class="text-sm text-muted-foreground">Итого к оплате</span>
              <span class="tabular-nums font-semibold">
                {{ formatAmount(finalAmount) }} ₽
                <span v-if="hasDiscount" class="ml-1 text-xs font-normal text-muted-foreground">
                  (−{{ formatAmount(discountAmount) }} ₽)
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
                  <!-- Без FormControl: его атрибуты id/aria-* рассчитаны прямо на
                     обернутый элемент, а настоящая кнопка здесь спрятана за
                     слоями Popover/PopoverTrigger (как и в случае ServicePicker
                     выше, сквозные атрибуты componentField — не простой input). -->
                  <MasterMultiSelect
                    v-bind="componentField"
                    :options="mastersForMaster"
                    :max="MAX_MASTERS"
                    class="min-h-11"
                  />
                  <FormMessage />
                  <Alert v-if="daysOff.length > 0" variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>Выходной по графику</AlertTitle>
                    <AlertDescription>
                      <p v-for="line in daysOff" :key="line">{{ line }}</p>
                    </AlertDescription>
                  </Alert>
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
                      <SelectItem v-for="r in mastersForResponsible" :key="r" :value="r">
                        {{ r }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              </FormField>
            </div>
          </CardContent>
        </Card>
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
