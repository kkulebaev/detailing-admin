import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { Readiness } from '@detailing-admin/shared/enums'

// Аккаунты для входа. Создаются вне приложения через CLI `user:create` (без
// самостоятельной регистрации). `passwordHash` хранит строку scrypt
// "scrypt:N:r:p:saltHex:hashHex"; `passwordChangedAt` записывается в JWT, чтобы
// будущий механизм отзыва мог отклонять токены, выпущенные до смены пароля.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: varchar('login', { length: 64 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 16 }).notNull(),
  // По умолчанию '', чтобы миграция была безопасна для уже существующих строк; пользователь
  // заполняет их на странице профиля (или CLI задаёт их при создании).
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
  // Для уже существующих клиентов заполнено временем миграции — исторические
  // даты добавления не восстановить (до появления этого столбца клиенты
  // upsert'ились по телефону без метки времени).
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert

// Best-effort автоматически накапливается из записей (см. приём в routes/bookings.ts);
// также цель будущего ручного CRUD. plate по умолчанию '' (не NULL) —
// UNIQUE-индекс не дедуплицирует NULL, а машина с пустым госномером валидна.
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

// Структурированное зеркало записей. Этап 1 миграции Sheets→приложение: каждая запись
// пишется сюда дополнительно (best-effort) рядом с главным append в Sheets.
// В отличие от сериализованной строки Sheets, столбцы хранят нормализованные значения
// (телефон в E.164, даты как DATE, сумма как int), чтобы при переключении таблица могла
// стать источником истины. `sheetRow`/`sheetRange` связывают строку с её строкой в Sheets;
// столбца `status` нет, потому что вставка бывает только после
// успешного append в Sheets.
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Надёжная дедупликация: защищает от второй строки, когда клиент повторяет запрос
    // с тем же ключом после истечения TTL in-memory идемпотентности (5 мин).
    idempotencyKey: text('idempotency_key').notNull().unique(),
    // Nullable: при пустом (не нормализуемом) телефоне связывать не с кем.
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
    // В Postgres столбец остаётся свободным `text`; `$type` сужает только TS-тип до
    // union READINESS (или '' для «нет статуса»), поэтому приведение на границе wire
    // не нужно. Только тип — без миграции и без эффекта в рантайме.
    readiness: text('readiness').notNull().default('').$type<Readiness | ''>(),
    master: text('master').array().notNull(),
    responsible: varchar('responsible', { length: 120 }).notNull(),
    // Производная id-связь с ответственным мастером. Nullable: `responsible` остаётся
    // главным снимком «как записано»; у ненайденного имени просто нет id.
    // `set null` при удалении мастера сохраняет строку (и её снимок) нетронутой.
    responsibleId: integer('responsible_id').references(() => masters.id, { onDelete: 'set null' }),
    // Производная id-связь с нормализованной строкой машины клиента. Nullable: склеенная
    // строка `car` остаётся главным снимком «как записано»; у строки без клиента,
    // ненайденной или с похожим госномером просто нет id. `set null` при удалении машины
    // сохраняет строку (и её снимок) — диалог клиента удаляет машины полной заменой
    // (syncClientCars), так что restrict блокировал бы обычную правку; если машину
    // добавят снова, связь восстановит backfill.
    carId: uuid('car_id').references(() => clientCars.id, { onDelete: 'set null' }),
    carClass: smallint('car_class').notNull(),
    sheetRow: integer('sheet_row'),
    sheetRange: text('sheet_range'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('bookings_date_from_idx').on(t.dateFrom),
    index('bookings_client_id_idx').on(t.clientId),
    // По нему фильтрует чтение машина→записи.
    index('bookings_car_id_idx').on(t.carId),
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
  // Одна цена на класс кузова (I–IV); *Max равен NULL → фиксированная цена (*Min),
  // не NULL → диапазон «Min–Max»
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
  // Ручной порядок кнопками ▲/▼; при reorder переписывается целиком, поэтому НЕ unique.
  position: integer('position').notNull(),
  canBeResponsible: boolean('can_be_responsible').notNull().default(true),
  // Получает ли мастер зарплату — фильтрует страницу «Зарплаты». По умолчанию
  // true, чтобы существующие мастера там остались; админ исключает отдельных.
  paidSalary: boolean('paid_salary').notNull().default(true),
  // «Удалить» лишь выставляет этот флаг: записи и история выплат продолжают ссылаться
  // на строку. API скрывает архивных мастеров, и пути назад нет; восстановление —
  // ручной UPDATE в базе.
  archived: boolean('archived').notNull().default(false),
  // Зарезервировано под будущие уведомления в Telegram; null, пока мастер его не привяжет.
  telegramId: varchar('telegram_id', { length: 64 }),
  // Аккаунт, который вносит часы за этого мастера в «Мои часы». UNIQUE: один аккаунт
  // соответствует одному мастеру. `set null` сохраняет мастера и историю выплат, если
  // аккаунт когда-нибудь удалят.
  userId: uuid('user_id')
    .unique()
    .references(() => users.id, { onDelete: 'set null' }),
})

export type Master = typeof masters.$inferSelect
export type NewMaster = typeof masters.$inferInsert

// Связующая таблица для id-связи многие-ко-многим запись↔мастер. `master text[]` в
// bookings остаётся главным снимком «как записано»; эта таблица несёт производную
// ссылочную связь, которую сторона чтения превращает в актуальные имена мастеров (и
// которая понадобится будущему JOIN сверки зарплат/часов). `position` привязывает связь
// к её слоту в снимке: обогащение при чтении накладывает актуальное имя на
// `master[position]`, так что ненайденный слот чисто откатывается к снимку.
// Оба FK каскадные: удаление записи чистит её связи, удаление мастера убирает
// его связи (имена в снимках записей не трогаются). Составной PK дедуплицирует,
// поэтому insert идемпотентен при onConflictDoNothing.
export const bookingMasters = pgTable(
  'booking_masters',
  {
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    masterId: integer('master_id')
      .notNull()
      .references(() => masters.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bookingId, t.masterId] }),
    index('booking_masters_master_id_idx').on(t.masterId),
  ],
)

export type BookingMaster = typeof bookingMasters.$inferSelect
export type NewBookingMaster = typeof bookingMasters.$inferInsert

// Текущая почасовая ставка мастера — источник снимка, копируемого в каждую строку
// work_hours. Намеренно ВНЕ `masters`: `GET /api/masters` делает `SELECT *`, открытый
// всем авторизованным ролям, так что столбец ставки там утёк бы к сотрудникам.
// PK = masterId → одна строка на мастера; нет строки = ставка не задана (LEFT JOIN
// даёт null, что отличается от ставки 0). Каскадное удаление допустимо: это
// «текущее», а не история — история лежит в work_hours (restrict).
export const masterRates = pgTable('master_rates', {
  masterId: integer('master_id')
    .primaryKey()
    .references(() => masters.id, { onDelete: 'cascade' }),
  hourlyRate: integer('hourly_rate').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type MasterRate = typeof masterRates.$inferSelect
export type NewMasterRate = typeof masterRates.$inferInsert

// Записи об отработанных часах. `rateSnapshot` замораживает ставку мастера при вставке,
// чтобы последующая смена ставки не переписала оплату прошлых месяцев. `onDelete: 'restrict'`
// (не cascade) — защита на уровне БД от потери истории выплат при удалении строки
// мастера; приложение мастеров только архивирует, см. deleteMaster().
// `minutes` (а не дробные часы) сохраняет арифметику целочисленной — «деньги = int».
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

// Разовые суммы, не связанные с отработанными часами: премии, компенсации и
// (отрицательные) удержания. Снимка ставки нет по замыслу — сумма
// самодостаточна. `restrict`, как у work_hours: это история выплат.
export const payouts = pgTable(
  'payouts',
  {
    id: serial('id').primaryKey(),
    masterId: integer('master_id')
      .notNull()
      .references(() => masters.id, { onDelete: 'restrict' }),
    payoutDate: date('payout_date').notNull(),
    // Целые рубли; отрицательное значение — удержание. Ноль отклоняет и БД:
    // Zod покрывает только HTTP, а backfill и seed-скрипты идут в обход него.
    amount: integer('amount').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payouts_master_date_idx').on(t.masterId, t.payoutDate),
    check('payouts_amount_nonzero', sql`${t.amount} <> 0`),
  ],
)

export type PayoutRow = typeof payouts.$inferSelect
export type NewPayout = typeof payouts.$inferInsert
