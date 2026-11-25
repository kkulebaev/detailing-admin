import type { NotificationType } from '@detailing-admin/shared/notifications'
import type { Role } from '@detailing-admin/shared/auth'

// Чистые функции «событие → строки ленты». Получателей и тексты считают здесь, а не в
// местах вызова, чтобы правила (кому, без автора, с какой ссылкой) жили в одном месте
// и проверялись без базы.

export interface NotificationDraft {
  userId: string
  type: NotificationType
  title: string
  body: string
  link: string | null
  // Текст для пуша и Telegram; null — тот же, что в ленте.
  pushBody: string | null
}

export interface RecipientAccount {
  userId: string
  role: Role
}

// ── Записи ──────────────────────────────────────────────────────────────────

export interface BookingSummary {
  id: string
  name: string
  car: string
  service: string
  // ISO YYYY-MM-DD, как в таблице bookings.
  dateFrom: string
  dateTo: string | null
  timeFrom: string
  timeTo: string | null
}

export type BookingEvent =
  | { kind: 'create' | 'restore' | 'delete'; booking: BookingSummary; masterIds: number[] }
  | {
      kind: 'update'
      before: BookingSummary
      after: BookingSummary
      beforeMasterIds: number[]
      afterMasterIds: number[]
    }

const SERVICE_MAX_LENGTH = 80

function shorten(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function dayMonth(iso: string): string {
  const [, m, d] = iso.split('-')
  return m && d ? `${d}.${m}` : iso
}

function fullDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

function bookingWhen(b: BookingSummary): string {
  const days =
    b.dateTo && b.dateTo !== b.dateFrom
      ? `${dayMonth(b.dateFrom)}–${dayMonth(b.dateTo)}`
      : dayMonth(b.dateFrom)
  const time = b.timeTo ? `${b.timeFrom}–${b.timeTo}` : b.timeFrom
  return time ? `${days}, ${time}` : days
}

// Имя клиента есть только в ленте: пуш виден на экране блокировки и уходит через
// сторонний push-сервис, а телефона и сумм в событиях по записям нет вовсе.
function bookingTexts(b: BookingSummary): { body: string; pushBody: string } {
  const car = b.car.trim()
  const service = shorten(b.service, SERVICE_MAX_LENGTH)
  const when = bookingWhen(b)
  return {
    body: [when, b.name.trim(), car, service].filter(Boolean).join(' · '),
    pushBody: [when, car, service].filter(Boolean).join(' · '),
  }
}

type BookingChange = 'date' | 'time' | 'car' | 'service'

// Перенос дня важнее времени: при смене даты время мастер увидит в тексте и так.
function bookingChanges(before: BookingSummary, after: BookingSummary): BookingChange[] {
  const changes: BookingChange[] = []
  if (before.dateFrom !== after.dateFrom || before.dateTo !== after.dateTo) changes.push('date')
  else if (before.timeFrom !== after.timeFrom || before.timeTo !== after.timeTo)
    changes.push('time')
  if (before.car !== after.car) changes.push('car')
  if (before.service !== after.service) changes.push('service')
  return changes
}

const CHANGE_NOUNS: Record<BookingChange, string> = {
  date: 'дата',
  time: 'время',
  car: 'авто',
  service: 'услуга',
}

const SINGLE_CHANGE_TITLES: Record<BookingChange, string> = {
  date: 'Запись перенесена',
  time: 'Изменилось время записи',
  car: 'Изменилось авто в записи',
  service: 'Изменилась услуга в записи',
}

// Больше двух перемен в заголовок не влезают: тогда только общий смысл, детали в тексте.
export function bookingChangedTitle(changes: readonly BookingChange[]): string {
  const [first, second] = changes
  if (!first) return 'Изменилась запись'
  if (changes.length === 1) return SINGLE_CHANGE_TITLES[first]
  if (changes.length === 2 && second)
    return `Изменились ${CHANGE_NOUNS[first]} и ${CHANGE_NOUNS[second]}`
  return 'Изменились детали записи'
}

function bookingLink(id: string): string {
  return `/bookings?booking=${id}`
}

export function bookingNotifications(
  event: BookingEvent,
  // Мастер → его аккаунт; мастера без аккаунта (или архивного) здесь нет.
  accounts: ReadonlyMap<number, { userId: string }>,
  actorId: string | null,
): NotificationDraft[] {
  const drafts: NotificationDraft[] = []
  const seen = new Set<string>()
  const push = (
    masterIds: readonly number[],
    type: NotificationType,
    title: string,
    b: BookingSummary,
    link: string | null,
  ) => {
    for (const masterId of masterIds) {
      const userId = accounts.get(masterId)?.userId
      if (!userId || userId === actorId || seen.has(userId)) continue
      seen.add(userId)
      drafts.push({ userId, type, title, link, ...bookingTexts(b) })
    }
  }

  switch (event.kind) {
    case 'create':
      push(
        event.masterIds,
        'booking.assigned',
        'У вас новая запись',
        event.booking,
        bookingLink(event.booking.id),
      )
      break
    case 'restore':
      push(
        event.masterIds,
        'booking.assigned',
        'Удаленную запись вернули',
        event.booking,
        bookingLink(event.booking.id),
      )
      break
    case 'delete':
      push(event.masterIds, 'booking.unassigned', 'Запись удалили', event.booking, '/bookings')
      break
    case 'update': {
      const before = new Set(event.beforeMasterIds)
      const after = new Set(event.afterMasterIds)
      const added = event.afterMasterIds.filter((id) => !before.has(id))
      const removed = event.beforeMasterIds.filter((id) => !after.has(id))
      const stayed = event.afterMasterIds.filter((id) => before.has(id))
      const link = bookingLink(event.after.id)
      push(added, 'booking.assigned', 'Вас добавили в запись', event.after, link)
      // Снятому мастеру показываем запись такой, какой он ее знал.
      push(removed, 'booking.unassigned', 'Вас убрали из записи', event.before, '/bookings')
      // Готовность, сумма и прочее мастеру не важны: о них уведомлять — только шуметь.
      const changes = bookingChanges(event.before, event.after)
      if (changes.length > 0)
        push(stayed, 'booking.changed', bookingChangedTitle(changes), event.after, link)
      break
    }
  }
  return drafts
}

// ── Заявки на график ────────────────────────────────────────────────────────

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

// Заявка хранит только перемены, так что working: true — день станет рабочим,
// false — выходным. «2 рабочих дня и 1 выходной» понятнее голого «3 дня».
function scheduleDaysText(days: readonly { working: boolean }[]): string {
  const working = days.filter((d) => d.working).length
  const off = days.length - working
  return [
    working > 0 ? plural(working, 'рабочий день', 'рабочих дня', 'рабочих дней') : '',
    off > 0 ? plural(off, 'выходной', 'выходных', 'выходных') : '',
  ]
    .filter(Boolean)
    .join(' и ')
}

export function scheduleRequestCreatedNotifications(
  request: { masterName: string; days: readonly { working: boolean }[] },
  adminIds: readonly string[],
  actorId: string | null,
): NotificationDraft[] {
  const body = `${request.masterName} просит ${scheduleDaysText(request.days)}`
  return [...new Set(adminIds)]
    .filter((userId) => userId !== actorId)
    .map((userId) => ({
      userId,
      type: 'schedule_request.created' as const,
      title: 'Заявка на изменение графика',
      body,
      link: '/schedule',
      pushBody: null,
    }))
}

export function scheduleRequestDecidedNotifications(
  decision: { approve: boolean; comment: string | null; days: readonly { working: boolean }[] },
  // Аккаунт мастера на момент решения; null, если мастер ни к кому не привязан.
  recipientId: string | null,
  actorId: string | null,
): NotificationDraft[] {
  if (!recipientId || recipientId === actorId) return []
  const comment = decision.comment?.trim()
  return [
    {
      userId: recipientId,
      type: 'schedule_request.decided',
      title: decision.approve ? 'Заявку на график одобрили' : 'Заявку на график отклонили',
      body: decision.approve
        ? `Уже в графике: ${scheduleDaysText(decision.days)}`
        : comment
          ? `Причина: ${comment}`
          : 'График остался прежним',
      link: '/schedule',
      pushBody: null,
    },
  ]
}

// ── Деньги ──────────────────────────────────────────────────────────────────

export type MoneyAction = 'create' | 'update' | 'delete'

interface PayoutFacts {
  payoutDate: string
  amount: number
  note: string
}

interface HoursFacts {
  workDate: string
  minutes: number
}

// У правки есть прежнее значение: мастеру важно не только «сколько теперь», но и «сколько было».
export type MoneyEvent =
  | { type: 'payout.changed'; action: 'create' | 'delete'; payout: PayoutFacts }
  | { type: 'payout.changed'; action: 'update'; payout: PayoutFacts; before: PayoutFacts }
  | { type: 'work_hours.changed'; action: 'create' | 'delete'; hours: HoursFacts }
  | { type: 'work_hours.changed'; action: 'update'; hours: HoursFacts; before: HoursFacts }

const PAYOUT_TITLES: Record<MoneyAction, string> = {
  create: 'Новая выплата',
  update: 'Выплату изменили',
  delete: 'Выплату отменили',
}
const DEDUCTION_TITLES: Record<MoneyAction, string> = {
  create: 'Новое удержание',
  update: 'Удержание изменили',
  delete: 'Удержание отменили',
}
const HOURS_TITLES: Record<MoneyAction, string> = {
  create: 'Вам записали часы',
  update: 'Ваши часы изменили',
  delete: 'Ваши часы удалили',
}

function rubles(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('ru-RU')
  return `${amount < 0 ? '−' : ''}${abs} ₽`
}

function hoursText(minutes: number): string {
  return `${(minutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ч`
}

function withWas(now: string, was: string | null): string {
  return was !== null && was !== now ? `${now} (было ${was})` : now
}

// Сумма со знаком идет первой: по «−» в начале лента красит удержание, не разбирая
// заголовок.
function payoutBody(p: PayoutFacts, before: PayoutFacts | null): string {
  return [
    withWas(rubles(p.amount), before && rubles(before.amount)),
    withWas(fullDate(p.payoutDate), before && fullDate(before.payoutDate)),
    p.note.trim(),
  ]
    .filter(Boolean)
    .join(' · ')
}

function hoursBody(h: HoursFacts, before: HoursFacts | null): string {
  const hours = withWas(hoursText(h.minutes), before && hoursText(before.minutes))
  const date = withWas(fullDate(h.workDate), before && fullDate(before.workDate))
  return `${hours} за ${date}`
}

// Маршрут /employee админу закрыт, поэтому свою выплату он смотрит в «Зарплатах».
function moneyLink(role: Role): string {
  return role === 'admin' ? '/salaries' : '/employee'
}

export function moneyNotifications(
  event: MoneyEvent,
  recipient: RecipientAccount | null,
  actorId: string | null,
): NotificationDraft[] {
  if (!recipient || recipient.userId === actorId) return []
  const base = { userId: recipient.userId, link: moneyLink(recipient.role), pushBody: null }
  if (event.type === 'payout.changed') {
    const titles = event.payout.amount < 0 ? DEDUCTION_TITLES : PAYOUT_TITLES
    const before = event.action === 'update' ? event.before : null
    return [
      {
        ...base,
        type: event.type,
        title: titles[event.action],
        body: payoutBody(event.payout, before),
      },
    ]
  }
  const before = event.action === 'update' ? event.before : null
  return [
    {
      ...base,
      type: event.type,
      title: HOURS_TITLES[event.action],
      body: hoursBody(event.hours, before),
    },
  ]
}
