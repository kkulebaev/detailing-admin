import type { AuditValue, BookingAuditAction, BookingAuditEntry } from '@detailing-admin/shared'
import { isoToDdmmyyyy } from './date'
import { formatAmount } from './money'

const FIELD_LABELS: Record<string, string> = {
  name: 'Имя',
  phone: 'Телефон',
  car: 'Авто',
  service: 'Услуга',
  note: 'Примечание',
  amount: 'Сумма',
  amountFormula: 'Формула суммы',
  dateFrom: 'Дата',
  dateTo: 'Дата окончания',
  timeFrom: 'Время',
  timeTo: 'Время окончания',
  readiness: 'Готовность',
  master: 'Мастер',
  responsible: 'Ответственный',
  carClass: 'Класс авто',
}

const ACTION_LABELS: Record<BookingAuditAction, string> = {
  create: 'Создал(а) запись',
  update: 'Изменил(а)',
  delete: 'Удалил(а) запись',
  restore: 'Восстановил(а) запись',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

export function auditActionLabel(action: BookingAuditAction): string {
  return ACTION_LABELS[action]
}

export function auditActor(entry: Pick<BookingAuditEntry, 'actorName' | 'actorLogin'>): string {
  return entry.actorName || entry.actorLogin
}

// Пустое значение показываем прочерком: «'' → Выдана» на экране выглядит как опечатка.
export function formatAuditValue(field: string, value: AuditValue): string {
  if (value === null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'number')
    return field === 'amount' ? `${formatAmount(value)} ₽` : String(value)
  if (ISO_DATE.test(value)) return isoToDdmmyyyy(value)
  return value
}

// Время журнала — момент действия, а не дата записи, поэтому с часами и минутами
// в поясе устройства (сотрудники и студия в одном поясе).
export function formatAuditTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
