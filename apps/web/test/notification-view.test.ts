import { describe, expect, it } from 'vitest'
import { CarFront, Clock, MinusCircle, Wallet } from '@lucide/vue'
import type { Notification } from '@/lib/notifications-api'
import { formatTime, groupByDay, notificationVisual } from '@/lib/notification-view'

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
  it('выбирает иконку и группу по типу', () => {
    expect(notificationVisual({ type: 'booking.assigned', body: 'x' })).toMatchObject({
      group: 'booking',
      icon: CarFront,
    })
    expect(notificationVisual({ type: 'schedule_request.decided', body: 'x' }).group).toBe(
      'schedule',
    )
    expect(notificationVisual({ type: 'work_hours.changed', body: 'x' })).toMatchObject({
      group: 'money',
      icon: Clock,
    })
  })

  it('удержание отличается от выплаты по знаку суммы', () => {
    const payout = notificationVisual({ type: 'payout.changed', body: '5 000 ₽ · 20.11.2026' })
    const deduction = notificationVisual({ type: 'payout.changed', body: '−500 ₽ · 20.11.2026' })
    expect(payout.icon).toBe(Wallet)
    expect(deduction.icon).toBe(MinusCircle)
    expect(deduction.tone).not.toBe(payout.tone)
  })

  it('знак суммы распознается и в старых снимках, и при правке выплаты', () => {
    const legacy = notificationVisual({ type: 'payout.changed', body: '−500 ₽ · 20.11.2026' })
    const edited = notificationVisual({
      type: 'payout.changed',
      body: '500 ₽ (было −500 ₽) · 20.11.2026',
    })
    expect(legacy.icon).toBe(MinusCircle)
    expect(edited.icon).toBe(Wallet)
  })

  it('минус в теле других типов удержанием не считается', () => {
    expect(notificationVisual({ type: 'work_hours.changed', body: '−' }).icon).toBe(Clock)
  })
})

describe('formatTime', () => {
  it('показывает часы и минуты', () => {
    expect(formatTime(new Date(2026, 10, 25, 15, 54).toISOString())).toBe('15:54')
  })
})
