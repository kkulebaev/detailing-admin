import type { Component } from 'vue'
import { CalendarDays, CarFront, Clock, Wallet } from '@lucide/vue'
import type { Notification } from '@/lib/notifications-api'

export type NotificationCategory = 'booking' | 'schedule' | 'payout' | 'hours'

export interface NotificationVisual {
  category: NotificationCategory
  label: string
  icon: Component
  // Классы подложки и иконки: приглушенный цвет категории, читаемый в обеих темах.
  tone: string
}

export const NOTIFICATION_CATEGORIES: Record<
  NotificationCategory,
  Omit<NotificationVisual, 'category'>
> = {
  booking: {
    label: 'Записи',
    icon: CarFront,
    tone: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  },
  schedule: {
    label: 'График',
    icon: CalendarDays,
    tone: 'bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  },
  payout: {
    label: 'Выплаты',
    icon: Wallet,
    tone: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  },
  hours: {
    label: 'Часы',
    icon: Clock,
    tone: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  },
}

// Record, а не switch с default: новый тип без категории не соберется.
const CATEGORY_OF: Record<Notification['type'], NotificationCategory> = {
  'booking.assigned': 'booking',
  'booking.changed': 'booking',
  'booking.unassigned': 'booking',
  'schedule_request.created': 'schedule',
  'schedule_request.decided': 'schedule',
  'payout.changed': 'payout',
  'work_hours.changed': 'hours',
}

const DEDUCTION_TONE = 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300'

// Удержание сервер отдельным типом не помечает, но тело выплаты всегда начинается с суммы
// со знаком. Заголовок не годится: его формулировки меняются, а лента хранит старые снимки.
function isDeduction(n: Pick<Notification, 'type' | 'body'>): boolean {
  return n.type === 'payout.changed' && /^[−-]/.test(n.body.trimStart())
}

// Удержание остается в «Выплатах» с тем же значком и отличается только цветом.
export function notificationVisual(n: Pick<Notification, 'type' | 'body'>): NotificationVisual {
  const category = CATEGORY_OF[n.type]
  const visual = { category, ...NOTIFICATION_CATEGORIES[category] }
  return isDeduction(n) ? { ...visual, tone: DEDUCTION_TONE } : visual
}

export interface NotificationDay {
  key: string
  label: string
  items: Notification[]
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Порядок элементов сохраняется (лента уже идет от новых к старым), поэтому
// дни получаются подряд и догруженная страница просто дополняет последнюю группу.
export function groupByDay(items: Notification[], now: Date = new Date()): NotificationDay[] {
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const days: NotificationDay[] = []
  for (const n of items) {
    const created = new Date(n.createdAt)
    const key = dayKey(created)
    const last = days[days.length - 1]
    if (last && last.key === key) {
      last.items.push(n)
      continue
    }
    const label =
      key === today
        ? 'Сегодня'
        : key === yesterday
          ? 'Вчера'
          : created.toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'long',
              ...(created.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
            })
    days.push({ key, label, items: [n] })
  }
  return days
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

// Собрано из частей: целиком toLocaleString дает «25 ноября 2026 г. в 15:54».
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return `${day} ${d.getFullYear()}, ${formatTime(iso)}`
}
