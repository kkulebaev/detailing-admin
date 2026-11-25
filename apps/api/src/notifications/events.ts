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

// Готовность, сумма и прочее мастеру не важны: о них уведомлять — только шуметь.
const BOOKING_NOTIFIED_FIELDS = [
  'dateFrom',
  'dateTo',
  'timeFrom',
  'timeTo',
  'car',
  'service',
] as const satisfies readonly (keyof BookingSummary)[]

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
        'Новая запись',
        event.booking,
        bookingLink(event.booking.id),
      )
      break
    case 'restore':
      push(
        event.masterIds,
        'booking.assigned',
        'Запись восстановлена',
        event.booking,
        bookingLink(event.booking.id),
      )
      break
    case 'delete':
      push(event.masterIds, 'booking.unassigned', 'Запись удалена', event.booking, '/bookings')
      break
    case 'update': {
      const before = new Set(event.beforeMasterIds)
      const after = new Set(event.afterMasterIds)
      const added = event.afterMasterIds.filter((id) => !before.has(id))
      const removed = event.beforeMasterIds.filter((id) => !after.has(id))
      const stayed = event.afterMasterIds.filter((id) => before.has(id))
      const link = bookingLink(event.after.id)
      push(added, 'booking.assigned', 'Вас назначили на запись', event.after, link)
      // Снятому мастеру показываем запись такой, какой он ее знал.
      push(removed, 'booking.unassigned', 'Вас сняли с записи', event.before, '/bookings')
      const changed = BOOKING_NOTIFIED_FIELDS.some((f) => event.before[f] !== event.after[f])
      if (changed) push(stayed, 'booking.changed', 'Запись изменена', event.after, link)
      break
    }
  }
  return drafts
}

// ── Заявки на график ────────────────────────────────────────────────────────

function pluralDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} день`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`
  return `${n} дней`
}

export function scheduleRequestCreatedNotifications(
  request: { masterName: string; dayCount: number },
  adminIds: readonly string[],
  actorId: string | null,
): NotificationDraft[] {
  const body = `${request.masterName} просит изменить график: ${pluralDays(request.dayCount)}`
  return [...new Set(adminIds)]
    .filter((userId) => userId !== actorId)
    .map((userId) => ({
      userId,
      type: 'schedule_request.created' as const,
      title: 'Новая заявка на график',
      body,
      link: '/schedule',
      pushBody: null,
    }))
}

export function scheduleRequestDecidedNotifications(
  decision: { approve: boolean; comment: string | null; dayCount: number },
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
      title: decision.approve ? 'Заявка на график одобрена' : 'Заявка на график отклонена',
      body: decision.approve
        ? `График обновлен: ${pluralDays(decision.dayCount)}`
        : comment
          ? `Комментарий: ${comment}`
          : 'Без комментария',
      link: '/schedule',
      pushBody: null,
    },
  ]
}

// ── Деньги ──────────────────────────────────────────────────────────────────

export type MoneyAction = 'create' | 'update' | 'delete'

export type MoneyEvent =
  | {
      type: 'payout.changed'
      action: MoneyAction
      payout: { payoutDate: string; amount: number; note: string }
    }
  | {
      type: 'work_hours.changed'
      action: MoneyAction
      hours: { workDate: string; minutes: number }
    }

const PAYOUT_TITLES: Record<MoneyAction, string> = {
  create: 'Выплата добавлена',
  update: 'Выплата изменена',
  delete: 'Выплата удалена',
}
const DEDUCTION_TITLES: Record<MoneyAction, string> = {
  create: 'Удержание добавлено',
  update: 'Удержание изменено',
  delete: 'Удержание удалено',
}
const HOURS_TITLES: Record<MoneyAction, string> = {
  create: 'Часы добавлены',
  update: 'Часы изменены',
  delete: 'Часы удалены',
}

function rubles(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('ru-RU')
  return `${amount < 0 ? '−' : ''}${abs} ₽`
}

function hoursText(minutes: number): string {
  return `${(minutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ч`
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
  const link = moneyLink(recipient.role)
  if (event.type === 'payout.changed') {
    const { amount, payoutDate, note } = event.payout
    const titles = amount < 0 ? DEDUCTION_TITLES : PAYOUT_TITLES
    return [
      {
        userId: recipient.userId,
        type: event.type,
        title: titles[event.action],
        body: [rubles(amount), fullDate(payoutDate), note.trim()].filter(Boolean).join(' · '),
        link,
        pushBody: null,
      },
    ]
  }
  return [
    {
      userId: recipient.userId,
      type: event.type,
      title: HOURS_TITLES[event.action],
      body: `${fullDate(event.hours.workDate)}: ${hoursText(event.hours.minutes)}`,
      link,
      pushBody: null,
    },
  ]
}
