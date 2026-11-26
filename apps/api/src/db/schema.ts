import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
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
import type {
  ScheduleRequestDay,
  ScheduleRequestStatus,
} from '@detailing-admin/shared/schedule-requests'
import type { AuditChange, BookingAuditAction } from '@detailing-admin/shared/booking-audit'
import type { BookingServiceLine } from '@detailing-admin/shared/booking'
import type { WorkRuleKind } from '@detailing-admin/shared/work-rules'
import type {
  ExternalNotificationChannel,
  NotificationType,
} from '@detailing-admin/shared/notifications'

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
  // заполняет их на странице профиля (или CLI задает их при создании).
  firstName: varchar('first_name', { length: 120 }).notNull().default(''),
  lastName: varchar('last_name', { length: 120 }).notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  passwordChangedAt: timestamp('password_changed_at').notNull().defaultNow(),
  // Chat id для уведомлений аккаунта. UNIQUE: один чат получает уведомления одного аккаунта.
  telegramChatId: varchar('telegram_chat_id', { length: 64 }).unique(),
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

// Best-effort автоматически накапливается из записей (см. прием в routes/bookings.ts);
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
// стать источником истины. `sheetRow`/`sheetRange` связывают строку с ее строкой в Sheets;
// столбца `status` нет, потому что вставка бывает только после
// успешного append в Sheets.
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Надежная дедупликация: защищает от второй строки, когда клиент повторяет запрос
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
    // Скидка в рублях, уже вычтенная из `amount`; нужна, чтобы пересчет суммы по
    // услугам при правке не терял ее.
    discount: integer('discount').notNull().default(0),
    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to'),
    timeFrom: varchar('time_from', { length: 5 }).notNull(),
    timeTo: varchar('time_to', { length: 5 }),
    // В Postgres столбец остается свободным `text`; `$type` сужает только TS-тип до
    // union READINESS (или '' для «нет статуса»), поэтому приведение на границе wire
    // не нужно. Только тип — без миграции и без эффекта в рантайме.
    readiness: text('readiness').notNull().default('').$type<Readiness | ''>(),
    master: text('master').array().notNull(),
    responsible: varchar('responsible', { length: 120 }).notNull(),
    // Производная id-связь с ответственным мастером. Nullable: `responsible` остается
    // главным снимком «как записано»; у ненайденного имени просто нет id.
    // `set null` при удалении мастера сохраняет строку (и ее снимок) нетронутой.
    responsibleId: integer('responsible_id').references(() => masters.id, { onDelete: 'set null' }),
    // Производная id-связь с нормализованной строкой машины клиента. Nullable: склеенная
    // строка `car` остается главным снимком «как записано»; у строки без клиента,
    // ненайденной или с похожим госномером просто нет id. `set null` при удалении машины
    // сохраняет строку (и ее снимок) — диалог клиента удаляет машины полной заменой
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
  // Штучная услуга: в форме записи у нее появляется счетчик количества,
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
// bookings остается главным снимком «как записано»; эта таблица несет производную
// ссылочную связь, которую сторона чтения превращает в актуальные имена мастеров (и
// которая понадобится будущему JOIN сверки зарплат/часов). `position` привязывает связь
// к ее слоту в снимке: обогащение при чтении накладывает актуальное имя на
// `master[position]`, так что ненайденный слот чисто откатывается к снимку.
// Оба FK каскадные: удаление записи чистит ее связи, удаление мастера убирает
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

// Услуги записи построчно, в порядке `position`. Раздел, название и цена — снимки
// «как выбрали» (цену в форме можно поправить вручную, а прайс потом меняется), а
// `serviceId` — производная связь: `set null` при удалении услуги из прайса
// оставляет строку на снимке. Текст `bookings.service` остается тем, что ушло в лист.
export const bookingServices = pgTable(
  'booking_services',
  {
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    serviceId: integer('service_id').references(() => services.id, { onDelete: 'set null' }),
    section: varchar('section', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    price: integer('price').notNull(),
    quantity: smallint('quantity').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.bookingId, t.position] }),
    index('booking_services_service_id_idx').on(t.serviceId),
    check('booking_services_price_nonnegative', sql`${t.price} >= 0`),
    check('booking_services_quantity_positive', sql`${t.quantity} >= 1`),
  ],
)

export type BookingServiceRow = typeof bookingServices.$inferSelect
export type NewBookingServiceRow = typeof bookingServices.$inferInsert

// Текущая почасовая ставка мастера — источник снимка, копируемого в каждую строку
// work_hours. Намеренно ВНЕ `masters`: `GET /api/masters` делает `SELECT *`, открытый
// всем авторизованным ролям, так что столбец ставки там утек бы к сотрудникам.
// PK = masterId → одна строка на мастера; нет строки = ставка не задана (LEFT JOIN
// дает null, что отличается от ставки 0). Каскадное удаление допустимо: это
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

// Виды работ мастера: строка есть — мастера можно назначить на эту работу, и она же
// хранит его оплату за нее. Цель — раздел целиком или услуга-исключение (ровно одно).
// Вне `masters` по той же причине, что и ставка: `GET /api/masters` открыт всем ролям.
// `cascade` со всех сторон: это текущая настройка, а не история денег — суммы,
// уже начисленные по ней, будут жить в собственных снимках.
export const masterWorkRules = pgTable(
  'master_work_rules',
  {
    id: serial('id').primaryKey(),
    masterId: integer('master_id')
      .notNull()
      .references(() => masters.id, { onDelete: 'cascade' }),
    sectionId: integer('section_id').references(() => sections.id, { onDelete: 'cascade' }),
    serviceId: integer('service_id').references(() => services.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull().$type<WorkRuleKind>(),
    percent: smallint('percent'),
    // Фикс в рублях за единицу услуги, по классу кузова I–IV.
    fixedClass1: integer('fixed_class_1'),
    fixedClass2: integer('fixed_class_2'),
    fixedClass3: integer('fixed_class_3'),
    fixedClass4: integer('fixed_class_4'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // NULL в target-колонке не равен другому NULL, поэтому каждый индекс ограничивает
    // только свой вид цели.
    uniqueIndex('master_work_rules_section_uq').on(t.masterId, t.sectionId),
    uniqueIndex('master_work_rules_service_uq').on(t.masterId, t.serviceId),
    check(
      'master_work_rules_one_target',
      sql`(${t.sectionId} is null) <> (${t.serviceId} is null)`,
    ),
    check(
      'master_work_rules_percent',
      sql`${t.kind} <> 'percent' or (${t.percent} between 0 and 100 and ${t.fixedClass1} is null and ${t.fixedClass2} is null and ${t.fixedClass3} is null and ${t.fixedClass4} is null)`,
    ),
    // Явные is not null: сравнение с NULL дает NULL, а CHECK пропускает NULL.
    check(
      'master_work_rules_fixed',
      sql`${t.kind} <> 'fixed' or (${t.percent} is null and ${t.fixedClass1} is not null and ${t.fixedClass2} is not null and ${t.fixedClass3} is not null and ${t.fixedClass4} is not null and ${t.fixedClass1} >= 0 and ${t.fixedClass2} >= 0 and ${t.fixedClass3} >= 0 and ${t.fixedClass4} >= 0)`,
    ),
    check('master_work_rules_kind', sql`${t.kind} in ('percent', 'fixed')`),
  ],
)

export type MasterWorkRuleRow = typeof masterWorkRules.$inferSelect
export type NewMasterWorkRuleRow = typeof masterWorkRules.$inferInsert

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

// Хранятся только рабочие дни: строка есть — мастер работает, нет — выходной.
// `cascade`: в отличие от часов и выплат, график не история денег, а мастера и так
// не удаляют, только архивируют.
export const masterSchedule = pgTable(
  'master_schedule',
  {
    masterId: integer('master_id')
      .notNull()
      .references(() => masters.id, { onDelete: 'cascade' }),
    workDate: date('work_date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.masterId, t.workDate] })],
)

// Режим работы студии: строка на каждый рабочий день недели (0 — понедельник),
// нет строки — студия в этот день закрыта, пустая таблица — режим не задан.
// Время в минутах от полуночи; закрытие строго позже открытия, через полночь не работают.
export const studioHours = pgTable(
  'studio_hours',
  {
    weekday: smallint('weekday').primaryKey(),
    opensAt: smallint('opens_at').notNull(),
    closesAt: smallint('closes_at').notNull(),
  },
  (t) => [
    check('studio_hours_weekday', sql`${t.weekday} between 0 and 6`),
    check(
      'studio_hours_range',
      sql`${t.opensAt} >= 0 and ${t.closesAt} <= 1440 and ${t.opensAt} < ${t.closesAt}`,
    ),
  ],
)

// Разовые выходные студии (праздники и т. п.) поверх режима по дням недели.
export const studioClosedDays = pgTable('studio_closed_days', {
  date: date('date').primaryKey(),
})

// Заявка сотрудника на изменение своего графика. Дни — снимок заявки в jsonb: их
// не ищут по дате, а применяются они к master_schedule только при одобрении.
// Частичный UNIQUE держит у мастера не больше одной заявки на согласовании.
// `decidedByName` — снимок, как в журнале: аккаунт админа могут переименовать или удалить.
export const scheduleRequests = pgTable(
  'schedule_requests',
  {
    id: serial('id').primaryKey(),
    masterId: integer('master_id')
      .notNull()
      .references(() => masters.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 })
      .notNull()
      .default('pending')
      .$type<ScheduleRequestStatus>(),
    days: jsonb('days').notNull().$type<ScheduleRequestDay[]>(),
    comment: text('comment'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    decidedAt: timestamp('decided_at'),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedByName: text('decided_by_name'),
  },
  (t) => [
    uniqueIndex('schedule_requests_one_pending')
      .on(t.masterId)
      .where(sql`${t.status} = 'pending'`),
    index('schedule_requests_master_idx').on(t.masterId, t.createdAt),
    check('schedule_requests_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
  ],
)

export type ScheduleRequestRow = typeof scheduleRequests.$inferSelect

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

// Журнал изменений. Удаление записи остается физическим, а полный снимок строки
// (вместе со связями мастеров) уходит сюда в той же транзакции: так удаленная запись
// не просачивается ни в одно чтение `bookings` (список, аналитика, суммы клиента),
// но ее можно восстановить с тем же id. `entity`/`entityId` — текст, чтобы журнал
// принимал и другие сущности, не только записи с uuid.
// `actorLogin`/`actorName` — снимки на момент действия: аккаунт могут переименовать или
// удалить (`set null`), а история должна остаться читаемой.
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    entity: varchar('entity', { length: 32 }).notNull(),
    entityId: text('entity_id').notNull(),
    action: varchar('action', { length: 16 }).notNull().$type<BookingAuditAction>(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorLogin: varchar('actor_login', { length: 64 }).notNull(),
    actorName: text('actor_name').notNull().default(''),
    // Для `update`: только изменившиеся поля, `{ поле: [было, стало] }`.
    changes: jsonb('changes').$type<AuditChange[]>(),
    // Для `delete`: все, что нужно для восстановления.
    snapshot: jsonb('snapshot').$type<BookingSnapshot>(),
    at: timestamp('at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId, t.at),
    index('audit_log_action_idx').on(t.entity, t.action, t.at),
  ],
)

// После JSON `createdAt` становится строкой.
export interface BookingSnapshot {
  booking: Omit<Booking, 'createdAt'> & { createdAt: string }
  masters: { masterId: number; position: number }[]
  // Нет в снимках, снятых до появления строк услуг.
  services?: BookingServiceLine[]
}

export type AuditLogRow = typeof auditLog.$inferSelect
export type NewAuditLogRow = typeof auditLog.$inferInsert

// Лента уведомлений аккаунта и заодно outbox для внешних каналов (см. notificationDeliveries).
// Заголовок и текст — готовые снимки, как `decidedByName`: переименование мастера или
// правка записи старую ленту не переписывают. `pushBody` — текст для пуша и Telegram,
// когда он отличается от ленты (у записей в нем нет имени клиента); null → `body`.
// Лента идет по id, а не по createdAt: внутри одной транзакции now() одинаковый.
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull().$type<NotificationType>(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    pushBody: text('push_body'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    readAt: timestamp('read_at'),
  },
  (t) => [
    index('notifications_user_id_idx').on(t.userId, t.id.desc()),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    // Sweeper ищет окно последних 15 минут, cleanup — старше 90 дней.
    index('notifications_created_at_idx').on(t.createdAt),
  ],
)

export type NotificationRow = typeof notifications.$inferSelect
export type NewNotificationRow = typeof notifications.$inferInsert

// Web Push подписка одного браузера. Endpoint уникален: на общем телефоне сменили
// логин, и та же подписка переходит к новому аккаунту, а не дублируется. Подписка,
// на которую push-сервис ответил 404/410, удаляется: браузер ее уже забыл.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at'),
    // Срок сессии, сохранившей подписку (exp ее JWT): после выхода по сроку телефон не
    // должен получать пуши аккаунта. Каждый upsert ставит настоящий exp; default нужен
    // только миграции, чтобы добавить колонку к уже существующим строкам: они сразу
    // считаются истекшими, и владелец заново включает пуши.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_subscriptions_user_id_idx').on(t.userId)],
)

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect

// Какой внешний канал уже занял уведомление. Отметка на канал, а не одна на строку:
// если упал только Telegram, sweeper дошлет его, не повторяя пуш. Строка вставляется до
// отправки (INSERT … ON CONFLICT DO NOTHING выбирает единственного отправителя) и
// удаляется, только если канал не смог даже начать отправку.
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    notificationId: integer('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 16 }).notNull().$type<ExternalNotificationChannel>(),
    claimedAt: timestamp('claimed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.channel] })],
)

// Одноразовый токен deep link t.me/<bot>?start=<token>. В базе только sha256: утекший
// дамп не дает привязать чужой Telegram. Срок короткий, просроченные чистит cleanup.
// Погашенный токен не удаляется, а получает usedAt: повторная доставка того же /start
// должна узнать, к какому аккаунту он был выписан.
export const telegramLinkTokens = pgTable('telegram_link_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
})
