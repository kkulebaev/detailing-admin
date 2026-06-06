import { z } from 'zod'
import {
  dbUnavailableErrorSchema,
  internalErrorSchema,
  notFoundErrorSchema,
  validationErrorSchema,
} from './api.js'

// Domain object schemas — mirror what the API serializes from Drizzle rows.

export const pricelistServiceSchema = z.object({
  id: z.number().int(),
  sectionId: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  priceClass1: z.number().nullable(),
  priceClass2: z.number().nullable(),
  priceClass3: z.number().nullable(),
  priceClass4: z.number().nullable(),
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

// Pricelist conflicts come in two flavours: duplicate section name and "section
// still has services" (delete guard). Services only carry the duplicate variant.
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

// Wire-level schemas — kept transform-free so orval generates clean TS types.
// Trim/empty-string handling moves to the route handler.
const optionalPrice = z.number().int().nonnegative().max(100_000_000).nullable()

export const sectionInputSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название раздела').max(120),
})

export type SectionInput = z.infer<typeof sectionInputSchema>

export const serviceInputSchema = z.object({
  sectionId: z.number().int().positive('Выберите раздел'),
  name: z.string().trim().min(1, 'Укажите название услуги').max(200),
  description: z.string().max(2000).nullable().default(null),
  priceClass1: optionalPrice.default(null),
  priceClass2: optionalPrice.default(null),
  priceClass3: optionalPrice.default(null),
  priceClass4: optionalPrice.default(null),
})

export type ServiceInput = z.infer<typeof serviceInputSchema>
