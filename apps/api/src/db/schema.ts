import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// Auth accounts. Provisioned out-of-band via the `user:create` CLI (no
// self-registration). `passwordHash` stores the scrypt string
// "scrypt:N:r:p:saltHex:hashHex"; `passwordChangedAt` is stamped into the JWT
// so a future revocation path can reject tokens issued before a password change.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: varchar('login', { length: 64 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 16 }).notNull(),
  // Default '' so the migration is safe for pre-existing rows; the user fills
  // these in on the profile page (or the CLI seeds them at creation).
  firstName: varchar('first_name', { length: 120 }).notNull().default(''),
  lastName: varchar('last_name', { length: 120 }).notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  passwordChangedAt: timestamp('password_changed_at').notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: varchar('phone', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull().default(''),
  // Backfilled to the migration time for pre-existing clients — historical
  // add-dates aren't recoverable (clients were upserted by phone with no
  // timestamp before this column existed).
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert

// Best-effort auto-accumulated from bookings (see routes/bookings.ts ingest);
// also the target of a future manual CRUD. plate defaults to '' (not NULL) —
// a UNIQUE index does not dedupe NULLs, and an empty plate is a valid car.
export const clientCars = pgTable(
  'client_cars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    makeModel: varchar('make_model', { length: 200 }).notNull(),
    plate: varchar('plate', { length: 32 }).notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('client_cars_uniq').on(t.clientId, t.makeModel, t.plate),
    index('client_cars_client_id_idx').on(t.clientId),
  ],
)

export type ClientCar = typeof clientCars.$inferSelect
export type NewClientCar = typeof clientCars.$inferInsert

// Structured bookings mirror. Stage 1 of the Sheets→app migration: every booking
// is dual-written here (best-effort) alongside the authoritative Sheets append.
// Unlike the serialized Sheets row, columns hold normalized values (phone in
// E.164, dates as DATE, amount as int) so the table can become the source of
// truth at cutover. `sheetRow`/`sheetRange` link a row back to its Sheets line;
// there is no `status` column because inserts only ever happen after a
// successful Sheets append.
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Durable dedup: guards against a second row when a client retries with the
    // same key after the in-memory idempotency TTL (5 min) has elapsed.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // Nullable: an empty (unnormalizable) phone yields no client to link.
    clientId: uuid('client_id').references(() => clients.id),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull().default(''),
    car: varchar('car', { length: 200 }).notNull(),
    service: text('service').notNull(),
    note: text('note').notNull().default(''),
    amount: integer('amount').notNull(),
    amountFormula: text('amount_formula'),
    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to'),
    timeFrom: varchar('time_from', { length: 5 }).notNull(),
    timeTo: varchar('time_to', { length: 5 }),
    readiness: text('readiness').notNull().default(''),
    master: varchar('master', { length: 120 }).notNull(),
    responsible: varchar('responsible', { length: 120 }).notNull(),
    carClass: smallint('car_class').notNull(),
    sheetRow: integer('sheet_row'),
    sheetRange: text('sheet_range'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('bookings_date_from_idx').on(t.dateFrom),
    index('bookings_client_id_idx').on(t.clientId),
  ],
)

export type Booking = typeof bookings.$inferSelect
export type NewBooking = typeof bookings.$inferInsert

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
  // Штучная услуга: в форме записи у неё появляется счётчик количества,
  // а сумма считается как цена за единицу × количество.
  countable: boolean('countable').notNull().default(false),
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

export const masters = pgTable('masters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull().unique(),
  // Manual ordering via ▲/▼ buttons; bulk-rewritten on reorder, hence NOT unique.
  position: integer('position').notNull(),
  canBeResponsible: boolean('can_be_responsible').notNull().default(true),
  // Whether this master is paid a salary — filters the Зарплаты page. Defaults
  // true so existing masters keep appearing there; admins opt individuals out.
  paidSalary: boolean('paid_salary').notNull().default(true),
  // Reserved for future Telegram notifications; nullable until a master links one.
  telegramId: varchar('telegram_id', { length: 64 }),
})

export type Master = typeof masters.$inferSelect
export type NewMaster = typeof masters.$inferInsert

// Current hourly rate per master — the source of the snapshot copied into each
// work_hours row. Kept OUT of `masters` on purpose: `GET /api/masters` does a
// `SELECT *` open to all authenticated roles, so a rate column there would leak
// to employees. PK = masterId → one row per master; no row = rate not set (a
// LEFT JOIN yields null, distinct from a 0 rate). Cascade delete is fine: this
// is "current", not history — the history lives in work_hours (restrict).
export const masterRates = pgTable('master_rates', {
  masterId: integer('master_id')
    .primaryKey()
    .references(() => masters.id, { onDelete: 'cascade' }),
  hourlyRate: integer('hourly_rate').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type MasterRate = typeof masterRates.$inferSelect
export type NewMasterRate = typeof masterRates.$inferInsert

// Records of hours worked. `rateSnapshot` freezes the master's rate at insert so
// a later rate change never rewrites past months' pay. `onDelete: 'restrict'`
// (not cascade) is the DB-level guard against losing payment history when a
// master is deleted; deleteMaster() also refuses in app code (has_work_hours).
// `minutes` (not float hours) keeps arithmetic integer — "money = int".
export const workHours = pgTable(
  'work_hours',
  {
    id: serial('id').primaryKey(),
    masterId: integer('master_id')
      .notNull()
      .references(() => masters.id, { onDelete: 'restrict' }),
    workDate: date('work_date').notNull(),
    minutes: integer('minutes').notNull(),
    rateSnapshot: integer('rate_snapshot').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('work_hours_master_date_idx').on(t.masterId, t.workDate)],
)

export type WorkHoursRow = typeof workHours.$inferSelect
export type NewWorkHours = typeof workHours.$inferInsert
