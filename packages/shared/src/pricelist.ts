import { z } from 'zod'

const optionalPrice = z
  .union([z.literal(''), z.literal(null), z.number().int().nonnegative().max(100_000_000)])
  .transform((v) => (typeof v === 'number' ? v : null))

export const sectionInputSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название раздела').max(120),
})

export type SectionInput = z.infer<typeof sectionInputSchema>

export const serviceInputSchema = z.object({
  sectionId: z.number().int().positive('Выберите раздел'),
  name: z.string().trim().min(1, 'Укажите название услуги').max(200),
  description: z
    .union([z.string().max(2000), z.literal(null)])
    .transform((v) => {
      if (v === null) return null
      const trimmed = v.trim()
      return trimmed.length === 0 ? null : trimmed
    })
    .default(null),
  priceClass1: optionalPrice.default(null),
  priceClass2: optionalPrice.default(null),
  priceClass3: optionalPrice.default(null),
  priceClass4: optionalPrice.default(null),
})

export type ServiceInput = z.infer<typeof serviceInputSchema>
