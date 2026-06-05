import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core'

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull().default(''),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
