<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, provide } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { z } from 'zod'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { v4 as uuid } from 'uuid'
import { toast } from 'vue-sonner'
import { Calendar as CalendarIcon, Pencil, TriangleAlert, User } from '@lucide/vue'
import { today, getLocalTimeZone, CalendarDate } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import { bookingSchema, DEFAULT_CAR_CLASS, MAX_MASTERS } from '@detailing-admin/shared'
import type { BookingApiResult, CarClass, MissedBookings } from '@detailing-admin/shared'
import { submitBooking } from '@/lib/api'
import { usePricelistQuery, useMastersQuery } from '@/lib/queries'
import { useAuthStore } from '@/stores/auth'
import { isoToDdmmyyyy } from '@/lib/date'
import { resolveMasterOptions } from '@/lib/master-options'
import { CAR_SUGGESTIONS } from '@/lib/car-suggestions'
import { maskThousands } from '@/lib/number-mask'
import { maskLicensePlate, PLATE_LETTERS } from '@/lib/license-plate'
import {
  formatServiceCell,
  formatAmountFormula,
  type ServiceBreakdownRow,
} from '@/lib/service-breakdown'
import { usePhoneInput, formatPastedPhone } from '@/composables/use-phone-input'
import { useClientLookup } from '@/composables/use-client-lookup'
import type { Car } from '@/lib/clients-api'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
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

// Выпадающие списки мастера/ответственного строятся по живой таблице `masters`, но
// никогда не должны делать оформление записи зависимым от Postgres — `resolveMasterOptions`
// откатывается к зашитому enum, когда списка нет или он пуст.
const { data: mastersData, asyncStatus: mastersStatus } = useMastersQuery()
const mastersForMaster = computed(() =>
  resolveMasterOptions(mastersData.value?.ok ? mastersData.value.masters : undefined, () => true),
)
const mastersForResponsible = computed(() =>
  resolveMasterOptions(
    mastersData.value?.ok ? mastersData.value.masters : undefined,
    (m) => m.canBeResponsible,
  ),
)
const mastersLoading = computed(
  () => mastersStatus.value === 'loading' && mastersData.value === undefined,
)
// Без запасного enum незагруженный или пустой список оставляет селект мастера
// пустым — предупреждаем явно, чтобы форма не выглядела молча сломанной.
const mastersWarning = computed(() => {
  if (mastersLoading.value || mastersForMaster.value.length > 0) return null
  return mastersData.value?.ok
    ? 'Список мастеров пуст. Добавьте мастеров на странице «Мастера».'
    : 'Список мастеров недоступен. Обновите страницу.'
})

// Тоггл «Отправить уведомление» имеет смысл, когда хотя бы у одного выбранного
// мастера записан Telegram ID. Имена в таблице masters уникальны, поэтому сверять
// выбранные имена с живым списком безопасно; если список не загрузился, проверять
// telegramId не по чему, и уведомления остаются недоступны.
const selectedMasters = computed(() => {
  const list = mastersData.value?.ok ? mastersData.value.masters : undefined
  const names = values.master ?? []
  if (!list || names.length === 0) return []
  return list.filter((m) => names.includes(m.name))
})
// Только мастера с Telegram ID реально получают сообщение (бэкенд шлет им и
// дедупит по telegramId). Под тоглом показываем, кто НЕ получит — выбранные
// мастера без Telegram ID (в т.ч. отсутствующие в живом списке).
const notifyRecipients = computed(() =>
  selectedMasters.value
    .filter((m) => typeof m.telegramId === 'string' && m.telegramId.trim().length > 0)
    .map((m) => m.name),
)
const canNotifyMaster = computed(() => notifyRecipients.value.length > 0)
const notifyMissing = computed(() =>
  (values.master ?? []).filter((name) => !notifyRecipients.value.includes(name)),
)
const notifyHint = computed(() =>
  (values.master?.length ?? 0) > 0 ? 'У мастеров не указан Telegram ID' : 'Выберите мастера',
)

// ── Ключ идемпотентности: один на все повторы, перегенерируется после успеха ───
const idempotencyKey = ref(uuid())

// Синхронизирован с `canNotifyMaster` ниже: при true по умолчанию включен, при false
// принудительно выключен. Обработчик отправки передает его значение на бэкенд как
// `notify`, и тот best-effort шлет мастеру сообщение в Telegram.
const sendNotification = ref(true)

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

function calToString(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

// Дата/время живут в собственных ref, чтобы пользователь мог печатать прямо в
// текстовые поля с маской. Поповер календаря — лишь альтернативный ввод, который
// пишет обратно в эти ref.
const dateFromText = ref(calToString(todayVal))
const dateToText = ref(calToString(todayVal))
const timeValue = ref('')
const timeToValue = ref('')

// Скрываем подписи ошибок «Invalid» / regex, пока пользователь реально не попробует
// отправить форму, иначе пустая исходная форма мелькает красным при монтировании.
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

function capitalizeWords(raw: string): string {
  return raw.replace(
    /(^|[\s\-])(\p{L})/gu,
    (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('ru'),
  )
}

function maskName(raw: string): string {
  return capitalizeWords(raw.replace(/\d/g, ''))
}

function maskCar(raw: string): string {
  return capitalizeWords(raw)
}

// Gboard держит набираемое слово в композиции до пробела/коммита, и правка
// value/каретки в этот момент сбивает сессию ввода: символы теряются, курсор
// прыгает. Пока композиция активна, маска не применяется — в форму уходит сырой
// текст, а закрывающий `input` (он приходит уже без флага) домаскирует его.
function isComposingInput(e: Event): boolean {
  return e instanceof InputEvent && e.isComposing
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

function formatAmount(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function amountDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

// Разница со знаком между «Сумма» и итогом по услугам (текущая − итог).
// null, когда сравнивать не с чем. Пустая сумма считается за 0.
const amountDelta = computed<number | null>(() => {
  if (servicesTotal.value === null) return null
  const digits = amountDigits(amountRaw.value)
  const current = digits === '' ? 0 : parseInt(digits, 10)
  return current - servicesTotal.value
})

// True, когда услуги выбраны, а «Сумма» уже не равна их итогу — т. е. оператор
// ввел свое значение (или воспользовался +пресетом).
const amountOverridden = computed(() => amountDelta.value !== null && amountDelta.value !== 0)

// «+2 500 ₽» / «−2 000 ₽» — насколько ручная сумма отличается от итога по услугам.
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

// ── Скидка (₽ или %) ──────────────────────────────────────────────────────────
// Чисто UI-помощник: применяется к «Сумма» (базе) и дает «Итого к оплате». При
// отправке в колонку суммы таблицы сохраняется итог со скидкой, а к примечанию
// дописывается строка «Скидка …» — отдельной колонки для скидки нет.
const discountRaw = ref('')
const discountUnit = ref<'rub' | 'pct'>('rub')

const baseAmount = computed(() => {
  const digits = amountDigits(amountRaw.value)
  return digits === '' ? 0 : parseInt(digits, 10)
})

// Скидка в рублях, ограниченная так, чтобы не превышать базу (% не больше 100).
// Процентная скидка округляется до ближайшего рубля.
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

// Перенормализуем сырое значение при смене единиц: для % убираем группировку и
// ограничиваем 100; для ₽ заново группируем разделителями тысяч.
function setDiscountUnit(unit: 'rub' | 'pct') {
  if (unit === discountUnit.value) return
  discountUnit.value = unit
  const digits = discountRaw.value.replace(/\D/g, '')
  if (digits === '') return
  discountRaw.value =
    unit === 'pct' ? String(Math.min(parseInt(digits, 10), 100)) : formatAmount(digits)
}

// «Скидка 10%» / «Скидка 950 ₽» — дописывается к примечанию при сохранении.
// Конкретная сумма в рублях, вычисленная из процентной скидки, намеренно не
// пишется; сохраняется только сам размер скидки.
function discountNoteLine(): string {
  if (!hasDiscount.value) return ''
  if (discountUnit.value === 'pct') {
    const pct = Math.min(parseInt(discountRaw.value.replace(/\D/g, '') || '0', 10), 100)
    return `Скидка ${pct}%`
  }
  return `Скидка ${formatAmount(String(discountAmount.value))} ₽`
}

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
  master: [],
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

// Синхронизируем тоггл уведомления с доступностью: выключен, когда у выбранного
// мастера нет Telegram ID, включен, как только выбран мастер, которого можно уведомить.
// Объявлен после useForm, чтобы немедленный запуск мог прочитать `values` (без ошибки TDZ).
watch(
  canNotifyMaster,
  (ok) => {
    sendNotification.value = ok
  },
  { immediate: true },
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
// Список подсказок сознательно собран на голом DOM, без Popover: на Android
// выбор тапом не доезжал ни через `mousedown`, ни через `click`. Что здесь
// принципиально и ломается при «упрощении»:
//   • список — обычный `absolute`-элемент рядом с полем, а не портал. У
//     `PopoverContent` есть `tabindex="-1"`, и тап по нему уводил фокус с поля;
//   • выбор висит на `pointerup`, а не на mouse-событиях: `pointer*` браузер
//     шлет всегда, а эмулированные mouse-события Chrome внутри прокручиваемого
//     контейнера придерживает и часто не шлет вовсе;
//   • скролл списка отделяется от тапа порогом сдвига пальца, иначе протяжка
//     выбирала бы случайный пункт (сам скролл жив: его решает `touch-action`, а
//     не `preventDefault` на pointerdown — тот лишь удерживает фокус в поле);
//   • пункты — `<li>`, а не `<button>`: неинтерактивный элемент не забирает
//     фокус, поле не теряет каретку и клавиатуру;
//   • список не закрывается по `blur` — тот прилетал раньше тапа. Закрытие: сам
//     выбор, Escape и `pointerdown` мимо поля и списка.
const carPopoverOpen = ref(false)
const carActiveIndex = ref(0)
const carListEl = ref<HTMLElement | null>(null)
const carInputEl = ref<HTMLInputElement | null>(null)
const MAX_CAR_SUGGESTIONS = 30
const filteredCars = computed<readonly string[]>(() => {
  const q = (values.car ?? '').trim().toLowerCase()
  if (!q) return CAR_SUGGESTIONS.slice(0, MAX_CAR_SUGGESTIONS)
  return CAR_SUGGESTIONS.filter((c) => c.toLowerCase().includes(q)).slice(0, MAX_CAR_SUGGESTIONS)
})
watch(filteredCars, () => {
  carActiveIndex.value = 0
})

function selectCar(car: string) {
  const el = carInputEl.value
  if (el) {
    // У PopoverContent есть `tabindex="-1"`, поэтому тап мимо `mousedown.prevent`
    // мог увести на него фокус — на мобильном это гасит клавиатуру.
    el.focus()
    // Фокус в поле означает, что Gboard может держать слово в композиции, а
    // v-model из Vue не трогает DOM, пока выставлен `el.composing`. Коммитим
    // композицию сами, иначе подсказка осядет только в состоянии формы.
    el.value = car
    el.setSelectionRange(car.length, car.length)
    el.dispatchEvent(new CompositionEvent('compositionend', { data: car }))
  }
  setFieldValue('car', car)
  carPopoverOpen.value = false
}

// Тап по уже сфокусированному полю не дает `focus`, поэтому список открывается и
// по клику — иначе вернуть его после выбора можно было бы только новым символом.
function openCarSuggestions(e: Event) {
  if (e.target instanceof HTMLInputElement) carInputEl.value = e.target
  carPopoverOpen.value = true
}

// Тап по самому полю или по списку список не гасит, все остальное — закрывает.
function onDocumentPointerDown(e: Event) {
  if (!carPopoverOpen.value) return
  const target = e.target
  if (
    target instanceof Element &&
    (target.closest('[data-car-input]') || target.closest('[data-car-suggestions]'))
  )
    return
  carPopoverOpen.value = false
}

// Тап и протяжка приходят одной и той же парой pointer-событий, поэтому выбор
// засчитывается только если палец практически не сдвинулся.
const CAR_TAP_SLOP_PX = 12
let carTapOrigin: { x: number; y: number } | null = null

function onCarItemPointerDown(e: PointerEvent, index: number) {
  carTapOrigin = { x: e.clientX, y: e.clientY }
  carActiveIndex.value = index
}

function onCarItemPointerUp(e: PointerEvent, car: string) {
  const origin = carTapOrigin
  carTapOrigin = null
  if (!origin) return
  if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > CAR_TAP_SLOP_PX) return
  selectCar(car)
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

// ── Обработчики текстовых полей даты / времени ───────────────────────────────
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
  if (isComposingInput(e)) {
    setFieldValue('name', target.value)
    return
  }
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
  carInputEl.value = target
  if (isComposingInput(e)) {
    setFieldValue('car', target.value)
    return
  }
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
  if (isComposingInput(e)) {
    licensePlate.value = target.value
    return
  }
  const masked = maskLicensePlate(target.value)
  if (target.value !== masked) {
    licensePlate.value = masked
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
}

// ── Обработчик поля суммы ─────────────────────────────────────────────────────
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
  amountRaw.value = formatAmount(String(total))
  setFieldValue('amount', total)
}

function onServiceBreakdown(rows: ServiceBreakdownRow[]) {
  serviceBreakdown.value = rows
}

// ── Обработчики выбора в календаре ────────────────────────────────────────────
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

// ── Отправка ──────────────────────────────────────────────────────────────────
const handleValidatedSubmit = handleSubmit(async (values) => {
  unavailableBanner.value = null
  const plate = licensePlate.value.trim()
  // Тоггл принудительно выключен, когда у мастера нет Telegram ID, поэтому его
  // значению можно верить; бэкенд перепроверяет и вслепую ему не доверяет.
  const payload = { ...values, plate: plate || undefined, notify: sendNotification.value }
  // В ячейку «Услуга» идет разбивка по категориям (только названия); поле формы
  // остается простым CSV из названий для восстановления черновика.
  if (serviceBreakdown.value.length > 0) {
    payload.service = formatServiceCell(serviceBreakdown.value)
    // «Сумма» несет арифметику, из которой сложился итог. `values.amount` — база
    // до скидки; формула сама вычитает скидку.
    const base = typeof values.amount === 'number' ? values.amount : 0
    payload.amountFormula = formatAmountFormula(serviceBreakdown.value, base, discountAmount.value)
  }
  // Скидка применяется при отправке: в таблицу пишется итог со скидкой, а сама
  // скидка сохраняется строкой в примечании (отдельной колонки нет).
  if (hasDiscount.value) {
    payload.amount = finalAmount.value
    payload.note = [values.note?.trim(), discountNoteLine()].filter(Boolean).join('\n')
  }
  let result: BookingApiResult
  try {
    result = await submitBooking(payload, idempotencyKey.value)
  } catch {
    const retry = () => {
      void onSubmit()
    }
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
    const retry = () => {
      void onSubmit()
    }
    toast.error('Ошибка при сохранении', {
      action: { label: 'Повторить', onClick: retry },
    })
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
      master: [],
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

// ── Сохранение черновика (localStorage) ──────────────────────────────────────
// v5: поле услуги перешло со свободного текста на пикер (выбор восстанавливается из CSV
// названий услуг по загруженному прайс-листу); добавлен carClass.
const DRAFT_KEY = 'detailing-admin:booking-draft:v5'

// Схема черновика намеренно либеральна — все поля необязательны, чтобы наполовину
// заполненная или более старая запись в localStorage парсилась без отказа.
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
  // Принимает и устаревшую форму одной строки из черновиков до мультимастеров (v5),
  // и текущий массив — loadDraft() ветвится в зависимости от того, что пришло.
  master: z.array(z.string()).or(z.string()).optional(),
  responsible: z.string().optional(),
  carClass: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

type Draft = z.infer<typeof draftSchema>

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* хранилище может быть отключено */
  }
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
    // `draft.master` теперь массив — `[]` в JS truthy, поэтому простая проверка `||`
    // сочла бы нетронутый черновик с пустым выбором «содержательным».
    const hasMaster = Array.isArray(draft.master) ? draft.master.length > 0 : Boolean(draft.master)
    const meaningful =
      draft.isRangeMode ||
      draft.timeValue ||
      draft.name ||
      draft.car ||
      draft.licensePlate ||
      draft.service ||
      draft.note ||
      draft.amountRaw ||
      draft.discountRaw ||
      hasMaster ||
      draft.responsible ||
      (draft.phoneRaw && draft.phoneRaw.replace(/\D/g, '').length > 1)
    if (!meaningful) {
      clearDraft()
      return
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* игнорируем */
  }
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
    // Старые черновики (до мультимастеров) хранили `master` одной строкой; наивный
    // `.trim()` здесь упал бы на новой форме-массиве, а исключение проглотил бы
    // внешний catch ниже, и весь черновик молча потерялся бы.
    if (Array.isArray(d.master)) {
      if (d.master.length > 0) setFieldValue('master', d.master)
    } else if (typeof d.master === 'string' && d.master.trim()) {
      setFieldValue('master', [d.master])
    }
    if (d.responsible && d.responsible.trim()) setFieldValue('responsible', d.responsible)
    if (d.carClass) setFieldValue('carClass', d.carClass)
  } catch {
    /* поврежденный черновик: игнорируем */
  }
}

// ── Тестовое заполнение (Ctrl+Shift+X) ───────────────────────────────────────
// Быстро набивает форму правдоподобными случайными данными для ручного
// тестирования. Услугу берем из уже загруженного прайс-листа — тогда «Сумма»
// пересчитается сама через ServicePicker; иначе выставляем сумму вручную.
const { data: pricelistData } = usePricelistQuery()

const TEST_NAMES = [
  'Иван Петров',
  'Мария Смирнова',
  'Алексей Иванов',
  'Ольга Кузнецова',
  'Дмитрий Соколов',
]
const TEST_NOTES = ['', 'Тестовая запись', 'Клиент просил перезвонить', 'Оплата картой']
const PLATE_LETTER_LIST = [...PLATE_LETTERS]

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function pickRandomMasters(arr: readonly string[], count: number): string[] {
  const pool = [...arr]
  const picked: string[] = []
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(idx, 1)[0]!)
  }
  return picked
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
  setFieldValue('master', pickRandomMasters(mastersForMaster.value, pickRandom([1, 2])))
  setFieldValue('responsible', pickRandom(mastersForResponsible.value))

  const r = pricelistData.value
  const allServices = r?.ok ? r.sections.flatMap((s) => s.services) : []
  if (allServices.length > 0) {
    const svc = pickRandom(allServices)
    // ServicePicker слушает modelValue: подхватит выбор и сам эмитнет «Сумму».
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
onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
onUnmounted(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))

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
  scheduleSave,
)
</script>

<template>
  <div class="min-h-screen bg-muted/30">
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
                      Потрачено: {{ formatAmount(String(matchedClientSummary.totalSpent)) }} ₽
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
                  <p
                    v-else-if="sendNotification && notifyMissing.length"
                    class="text-xs text-muted-foreground"
                  >
                    Не получат: {{ notifyMissing.join(', ') }}
                  </p>
                </div>
              </div>
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
