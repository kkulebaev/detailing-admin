import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'
import type { CarClass } from './booking.js'

// Схемы доменных объектов — повторяют то, что API сериализует из строк Drizzle.

// У каждого класса кузова (I–IV) своя цена. Фиксированная цена или диапазон
// кодируется полем Max: null → одна фиксированная цена (Min), не null →
// диапазон «Min–Max».
export const pricelistServiceSchema = z.object({
  id: z.number().int(),
  sectionId: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  // Штучная услуга — в форме записи получает счётчик количества.
  countable: z.boolean(),
  priceClass1Min: z.number(),
  priceClass1Max: z.number().nullable(),
  priceClass2Min: z.number(),
  priceClass2Max: z.number().nullable(),
  priceClass3Min: z.number(),
  priceClass3Max: z.number().nullable(),
  priceClass4Min: z.number(),
  priceClass4Max: z.number().nullable(),
})

export const pricelistSectionRowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
})

export const pricelistSectionSchema = pricelistSectionRowSchema.extend({
  services: z.array(pricelistServiceSchema),
})

export type PricelistService = z.infer<typeof pricelistServiceSchema>
export type PricelistSectionRow = z.infer<typeof pricelistSectionRowSchema>
export type PricelistSection = z.infer<typeof pricelistSectionSchema>

export interface PriceRange {
  min: number
  max: number | null
}

type ServicePrices = Pick<
  PricelistService,
  | 'priceClass1Min'
  | 'priceClass1Max'
  | 'priceClass2Min'
  | 'priceClass2Max'
  | 'priceClass3Min'
  | 'priceClass3Max'
  | 'priceClass4Min'
  | 'priceClass4Max'
>

export function servicePriceForClass(svc: ServicePrices, carClass: CarClass): PriceRange {
  switch (carClass) {
    case 1:
      return { min: svc.priceClass1Min, max: svc.priceClass1Max }
    case 2:
      return { min: svc.priceClass2Min, max: svc.priceClass2Max }
    case 3:
      return { min: svc.priceClass3Min, max: svc.priceClass3Max }
    case 4:
      return { min: svc.priceClass4Min, max: svc.priceClass4Max }
  }
}

// Конфликты прайс-листа бывают двух видов: дубль названия раздела и «в разделе
// ещё есть услуги» (защита удаления). У услуг бывает только вариант с дублем.
const pricelistConflictSchema = z.object({
  ok: z.literal(false),
  error: z.literal('conflict'),
  reason: z.union([z.literal('duplicate_name'), z.literal('has_services')]),
})

export const pricelistListResponseSchema = z.union([
  z.object({ ok: z.literal(true), sections: z.array(pricelistSectionSchema) }),
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const pricelistSectionMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), section: pricelistSectionRowSchema }),
  validationErrorSchema,
  pricelistConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const pricelistServiceMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), service: pricelistServiceSchema }),
  validationErrorSchema,
  pricelistConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

export const pricelistDeleteResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  pricelistConflictSchema,
  notFoundErrorSchema,
  dbUnavailableErrorSchema,
  internalErrorSchema,
])

// Схемы уровня провода — без transform, чтобы orval генерировал чистые TS-типы.
// Обработка trim и пустых строк переезжает в обработчик роута.
const requiredPrice = z.number().int().nonnegative().max(100_000_000)

export const sectionInputSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название раздела').max(120),
})

export type SectionInput = z.infer<typeof sectionInputSchema>

// Пары имён полей Min/Max для каждого класса кузова — общие для проверки диапазона
// во входной схеме и для потребителей, которым нужно пройти по всем четырём классам.
export const PRICE_CLASS_FIELDS = [
  ['priceClass1Min', 'priceClass1Max'],
  ['priceClass2Min', 'priceClass2Max'],
  ['priceClass3Min', 'priceClass3Max'],
  ['priceClass4Min', 'priceClass4Max'],
] as const

export const serviceInputSchema = z
  .object({
    sectionId: z.number().int().positive('Выберите раздел'),
    name: z.string().trim().min(1, 'Укажите название услуги').max(200),
    description: z.string().max(2000).nullable().default(null),
    countable: z.boolean().default(false),
    priceClass1Min: requiredPrice,
    priceClass1Max: requiredPrice.nullable().default(null),
    priceClass2Min: requiredPrice,
    priceClass2Max: requiredPrice.nullable().default(null),
    priceClass3Min: requiredPrice,
    priceClass3Max: requiredPrice.nullable().default(null),
    priceClass4Min: requiredPrice,
    priceClass4Max: requiredPrice.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    for (const [minKey, maxKey] of PRICE_CLASS_FIELDS) {
      const max = v[maxKey]
      if (max !== null && max < v[minKey]) {
        ctx.addIssue({
          code: 'custom',
          path: [maxKey],
          message: 'Максимальная цена не может быть меньше минимальной',
        })
      }
    }
  })

export type ServiceInput = z.infer<typeof serviceInputSchema>
