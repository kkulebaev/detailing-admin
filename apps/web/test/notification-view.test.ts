import { describe, expect, it } from 'vitest'
import { CalendarDays, CarFront, Clock, Wallet } from '@lucide/vue'
import type { Notification } from '@/lib/notifications-api'
import {
  NOTIFICATION_CATEGORIES,
  formatDateTime,
  formatTime,
  groupByDay,
  notificationVisual,
} from '@/lib/notification-view'

const note = (id: number, createdAt: string, over: Partial<Notification> = {}): Notification => ({
  id,
  type: 'booking.assigned',
  title: 'Заголовок',
  body: 'Текст',
  link: null,
  createdAt,
  readAt: null,
  ...over,
})

describe('groupByDay', () => {
  const now = new Date(2026, 10, 25, 18, 0)
  const at = (day: number, h: number, y = 2026) => new Date(y, 10, day, h, 0).toISOString()

  it('называет сегодня и вчера, остальные дни датой, и держит порядок', () => {
    const days = groupByDay(
      [note(5, at(25, 15)), note(4, at(25, 9)), note(3, at(24, 20)), note(2, at(20, 10))],
      now,
    )
    expect(days.map((d) => d.label)).toEqual(['Сегодня', 'Вчера', '20 ноября'])
    expect(days.map((d) => d.items.map((n) => n.id))).toEqual([[5, 4], [3], [2]])
  })

  it('добавляет год для прошлых лет', () => {
    const days = groupByDay([note(1, at(3, 12, 2025))], now)
    expect(days[0]?.label).toMatch(/^3 ноября 2025/)
  })

  it('пустая лента дает пустой список', () => {
    expect(groupByDay([], now)).toEqual([])
  })
})

describe('notificationVisual', () => {
  it.each([
    ['booking.assigned', 'Записи', CarFront],
    ['booking.changed', 'Записи', CarFront],
    ['booking.unassigned', 'Записи', CarFront],
    ['schedule_request.created', 'График', CalendarDays],
    ['schedule_request.decided', 'График', CalendarDays],
    ['payout.changed', 'Выплаты', Wallet],
    ['work_hours.changed', 'Часы', Clock],
  ] as const)('%s → «%s»', (type, label, icon) => {
    expect(notificationVisual({ type, body: '5 000 ₽' })).toMatchObject({ label, icon })
  })

  it('у каждой категории свой значок и цвет', () => {
    const visuals = Object.values(NOTIFICATION_CATEGORIES)
    expect(new Set(visuals.map((c) => c.icon)).size).toBe(visuals.length)
    expect(new Set(visuals.map((c) => c.tone)).size).toBe(visuals.length)
  })
})

describe('удержание', () => {
  it('тот же значок и категория, что у выплаты, но другой цвет', () => {
    const payout = notificationVisual({ type: 'payout.changed', body: '5 000 ₽ · 20.11.2026' })
    const deduction = notificationVisual({ type: 'payout.changed', body: '−500 ₽ · 20.11.2026' })
    expect(deduction).toMatchObject({ category: 'payout', label: 'Выплаты', icon: Wallet })
    expect(deduction.tone).not.toBe(payout.tone)
  })

  it('знак берется у новой суммы, а не у «было»', () => {
    const payout = notificationVisual({ type: 'payout.changed', body: '5 000 ₽' })
    const edited = notificationVisual({ type: 'payout.changed', body: '500 ₽ (было −500 ₽)' })
    expect(edited.tone).toBe(payout.tone)
  })

  it('минус в теле других типов удержанием не считается', () => {
    const hours = notificationVisual({ type: 'work_hours.changed', body: 'x' })
    expect(notificationVisual({ type: 'work_hours.changed', body: '−' }).tone).toBe(hours.tone)
  })
})

describe('formatTime', () => {
  it('показывает часы и минуты', () => {
    expect(formatTime(new Date(2026, 10, 25, 15, 54).toISOString())).toBe('15:54')
  })
})

describe('formatDateTime', () => {
  it('пишет дату полностью с годом и временем', () => {
    expect(formatDateTime(new Date(2026, 10, 25, 15, 54).toISOString())).toBe(
      '25 ноября 2026, 15:54',
    )
  })
})
