import type { Component } from 'vue'
import { Pencil, Plus, RotateCcw, Trash2 } from '@lucide/vue'
import type {
  AuditChange,
  AuditValue,
  BookingAuditAction,
  BookingAuditEntry,
} from '@detailing-admin/shared'
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

// Тон — заливка кружка с иконкой: тип действия читается цветом, не вчитываясь в текст.
export const AUDIT_ACTION_META: Record<
  BookingAuditAction,
  { noun: string; label: string; icon: Component; tone: string }
> = {
  create: {
    noun: 'создание',
    label: 'Создание',
    icon: Plus,
    tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  update: {
    noun: 'изменение',
    label: 'Изменение',
    icon: Pencil,
    tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  },
  delete: {
    noun: 'удаление',
    label: 'Удаление',
    icon: Trash2,
    tone: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  },
  restore: {
    noun: 'восстановление',
    label: 'Восстановление',
    icon: RotateCcw,
    tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
}

// Формула — техническая раскладка суммы: рядом с изменением самой суммы она только
// дублирует его, а без него (сброс формулы) ничего не говорит человеку.
const HIDDEN_FIELDS = new Set(['amountFormula'])

export function visibleAuditChanges(changes: AuditChange[] | null): AuditChange[] {
  return (changes ?? []).filter((c) => !HIDDEN_FIELDS.has(c.field))
}

export function isEmptyAuditValue(v: AuditValue): boolean {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
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

// Ключ календарного дня в поясе устройства: по нему журнал группирует события.
export function auditDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** «Сегодня», «Вчера», «15 ноября»; год — только если он не текущий. */
export function auditDayLabel(iso: string, now: Date = new Date()): string {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const key = auditDayKey(iso)
  if (key === auditDayKey(now.toISOString())) return 'Сегодня'
  if (key === auditDayKey(yesterday.toISOString())) return 'Вчера'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

export function formatAuditClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** День и время одной строкой — для списков без заголовков дней. */
export function formatAuditMoment(iso: string, now: Date = new Date()): string {
  return `${auditDayLabel(iso, now)}, ${formatAuditClock(iso)}`
}
