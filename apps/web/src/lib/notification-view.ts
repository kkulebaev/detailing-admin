import type { Component } from 'vue'
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CarFront,
  Clock,
  MinusCircle,
  Wallet,
} from '@lucide/vue'
import type { Notification } from '@/lib/notifications-api'

export type NotificationGroup = 'booking' | 'schedule' | 'money'

export interface NotificationVisual {
  group: NotificationGroup
  icon: Component
  // Классы подложки и иконки: приглушенный цвет группы, читаемый в обеих темах.
  tone: string
}

const TONES: Record<NotificationGroup | 'deduction', string> = {
  booking: 'bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  schedule: 'bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  money: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  deduction: 'bg-rose-500/10 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300',
}

// Удержание сервер отдельным типом не помечает, но тело выплаты всегда начинается с суммы
// со знаком. Заголовок не годится: его формулировки меняются, а лента хранит старые снимки.
function isDeduction(n: Pick<Notification, 'type' | 'body'>): boolean {
  return n.type === 'payout.changed' && /^[−-]/.test(n.body.trimStart())
}

export function notificationVisual(n: Pick<Notification, 'type' | 'body'>): NotificationVisual {
  if (isDeduction(n)) return { group: 'money', icon: MinusCircle, tone: TONES.deduction }
  switch (n.type) {
    case 'booking.assigned':
      return { group: 'booking', icon: CarFront, tone: TONES.booking }
    case 'booking.changed':
    case 'booking.unassigned':
      return { group: 'booking', icon: CalendarCheck, tone: TONES.booking }
    case 'schedule_request.created':
      return { group: 'schedule', icon: CalendarPlus, tone: TONES.schedule }
    case 'schedule_request.decided':
      return { group: 'schedule', icon: CalendarClock, tone: TONES.schedule }
    case 'payout.changed':
      return { group: 'money', icon: Wallet, tone: TONES.money }
    case 'work_hours.changed':
      return { group: 'money', icon: Clock, tone: TONES.money }
    default:
      return { group: 'booking', icon: CarFront, tone: TONES.booking }
  }
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
