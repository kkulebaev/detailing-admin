import { describe, it, expect } from 'vitest'
import {
  auditActor,
  auditDayLabel,
  auditFieldLabel,
  formatAuditValue,
  isEmptyAuditValue,
  visibleAuditChanges,
} from '@/lib/booking-audit'

describe('formatAuditValue', () => {
  it('показывает пустое значение прочерком', () => {
    expect(formatAuditValue('readiness', '')).toBe('—')
    expect(formatAuditValue('dateTo', null)).toBe('—')
    expect(formatAuditValue('master', [])).toBe('—')
  })

  it('форматирует сумму в рублях, а другие числа — как есть', () => {
    expect(formatAuditValue('amount', 12500)).toBe('12 500 ₽')
    expect(formatAuditValue('carClass', 3)).toBe('3')
  })

  it('переводит ISO-даты в DD.MM.YYYY и склеивает мастеров', () => {
    expect(formatAuditValue('dateFrom', '2026-06-04')).toBe('04.06.2026')
    expect(formatAuditValue('master', ['Иван', 'Петр'])).toBe('Иван, Петр')
  })
})

describe('подписи журнала', () => {
  it('подписывает известные поля по-русски и не теряет неизвестные', () => {
    expect(auditFieldLabel('amount')).toBe('Сумма')
    expect(auditFieldLabel('somethingNew')).toBe('somethingNew')
  })

  it('берет логин, когда имя в аккаунте не заполнено', () => {
    expect(auditActor({ actorName: '', actorLogin: 'admin' })).toBe('admin')
    expect(auditActor({ actorName: 'Анна К', actorLogin: 'admin' })).toBe('Анна К')
  })
})

describe('время события', () => {
  // Полдень, чтобы сдвиг пояса устройства не перекинул дату через полночь.
  const now = new Date(2026, 10, 16, 12, 0)
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 9, 30).toISOString()

  it('называет сегодня и вчера словами', () => {
    expect(auditDayLabel(at(2026, 10, 16), now)).toBe('Сегодня')
    expect(auditDayLabel(at(2026, 10, 15), now)).toBe('Вчера')
  })

  it('пишет дату словами и добавляет год только для прошлых лет', () => {
    expect(auditDayLabel(at(2026, 10, 10), now)).toBe('10 ноября')
    expect(auditDayLabel(at(2025, 11, 31), now)).toBe('31 декабря 2025 г.')
  })
})

describe('изменения для показа', () => {
  it('прячет формулу суммы', () => {
    const changes = [
      { field: 'amount', from: 5000, to: 6000 },
      { field: 'amountFormula', from: '=5000', to: null },
    ]
    expect(visibleAuditChanges(changes).map((c) => c.field)).toEqual(['amount'])
    expect(visibleAuditChanges(null)).toEqual([])
  })

  it('считает пустыми null, пустую строку и пустой список', () => {
    expect(isEmptyAuditValue(null)).toBe(true)
    expect(isEmptyAuditValue('')).toBe(true)
    expect(isEmptyAuditValue([])).toBe(true)
    expect(isEmptyAuditValue(0)).toBe(false)
  })
})
