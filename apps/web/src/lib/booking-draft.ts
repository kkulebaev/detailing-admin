import { z } from 'zod'

// v5: поле услуги перешло со свободного текста на пикер (выбор восстанавливается из CSV
// названий услуг по загруженному прайс-листу); добавлен carClass.
export const BOOKING_DRAFT_KEY = 'detailing-admin:booking-draft:v5'

// Схема черновика намеренно либеральна — все поля необязательны, чтобы наполовину
// заполненная или более старая запись в localStorage парсилась без отказа.
export const bookingDraftSchema = z.object({
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
  // и текущий массив — восстановление ветвится в зависимости от того, что пришло.
  master: z.array(z.string()).or(z.string()).optional(),
  responsible: z.string().optional(),
  carClass: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
})

export type BookingDraft = z.infer<typeof bookingDraftSchema>

// Дата сегодняшняя и префикс +7 есть в любой нетронутой форме, поэтому сами по себе
// они черновиком не считаются.
export function isMeaningfulBookingDraft(d: BookingDraft): boolean {
  // `[]` в JS truthy, поэтому простая проверка `||` сочла бы пустой выбор мастеров
  // «содержательным».
  const hasMaster = Array.isArray(d.master) ? d.master.length > 0 : Boolean(d.master)
  return Boolean(
    d.isRangeMode ||
    d.timeValue ||
    d.name ||
    d.car ||
    d.licensePlate ||
    d.service ||
    d.note ||
    d.amountRaw ||
    d.discountRaw ||
    hasMaster ||
    d.responsible ||
    (d.phoneRaw && d.phoneRaw.replace(/\D/g, '').length > 1),
  )
}
