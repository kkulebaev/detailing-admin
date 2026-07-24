import { integer, pgTable, serial, text, uuid, varchar } from 'drizzle-orm/pg-core'

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull().default(''),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert

export const sections = pgTable('sections', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull().unique(),
})

export type Section = typeof sections.$inferSelect
export type NewSection = typeof sections.$inferInsert

export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  sectionId: integer('section_id')
    .notNull()
    .references(() => sections.id),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  // One price per car body class (I–IV); *Max NULL → fixed price (*Min),
  // non-null → «Min–Max» range
  priceClass1Min: integer('price_class_1_min').notNull(),
  priceClass1Max: integer('price_class_1_max'),
  priceClass2Min: integer('price_class_2_min').notNull(),
  priceClass2Max: integer('price_class_2_max'),
  priceClass3Min: integer('price_class_3_min').notNull(),
  priceClass3Max: integer('price_class_3_max'),
  priceClass4Min: integer('price_class_4_min').notNull(),
  priceClass4Max: integer('price_class_4_max'),
})

export type Service = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert
