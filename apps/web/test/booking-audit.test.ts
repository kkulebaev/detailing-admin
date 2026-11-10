import { describe, it, expect } from 'vitest'
import { auditActor, auditFieldLabel, formatAuditValue } from '@/lib/booking-audit'

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
