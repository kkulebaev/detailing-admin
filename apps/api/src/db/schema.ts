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
  priceClass1: integer('price_class_1'),
  priceClass2: integer('price_class_2'),
  priceClass3: integer('price_class_3'),
  priceClass4: integer('price_class_4'),
})

export type Service = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert
