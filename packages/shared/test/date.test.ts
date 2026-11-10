import { describe, it, expect } from 'vitest'
import { parseDdmmyyyy, ddmmyyyyToIso } from '../src/date.js'

describe('parseDdmmyyyy', () => {
  it('разбирает 30.12.2025 в правильную дату UTC', () => {
    const d = parseDdmmyyyy('30.12.2025')
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(11) // с нуля: 11 = декабрь
    expect(d.getUTCDate()).toBe(30)
  })

  it('правильно упорядочивает даты через границу года', () => {
    const jan = parseDdmmyyyy('02.01.2026')
    const dec = parseDdmmyyyy('30.12.2025')
    expect(jan > dec).toBe(true)
  })

  it('бросает ошибку на 32-м дне', () => {
    expect(() => parseDdmmyyyy('32.01.2026')).toThrow()
  })

  it('бросает ошибку на 13-м месяце', () => {
    expect(() => parseDdmmyyyy('01.13.2026')).toThrow()
  })

  it('бросает ошибку на нечисловом вводе', () => {
    expect(() => parseDdmmyyyy('aa.bb.cccc')).toThrow()
  })
})

describe('ddmmyyyyToIso', () => {
  it('переставляет DD.MM.YYYY в YYYY-MM-DD без сдвига часового пояса', () => {
    expect(ddmmyyyyToIso('04.06.2026')).toBe('2026-06-04')
    expect(ddmmyyyyToIso('31.12.2025')).toBe('2025-12-31')
  })

  it('бросает ошибку на невалидной дате, а не выдаёт битую ISO-строку', () => {
    expect(() => ddmmyyyyToIso('32.01.2026')).toThrow()
    expect(() => ddmmyyyyToIso('01.13.2026')).toThrow()
  })
})
