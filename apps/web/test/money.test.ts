import { describe, it, expect } from 'vitest'
import { formatAmount, formatSigned } from '@/lib/money'

// В колонках выплат весь смысл в знаке: дефис вместо U+2212 рядом с табличными
// цифрами читается как тире, а без «+» премия выглядит как обычное число.
// Здесь закреплено и то, и другое.
describe('formatSigned', () => {
  it('ставит + перед положительной суммой и группирует разряды', () => {
    expect(formatSigned(5000)).toBe('+5 000')
  })

  it('ставит перед отрицательной суммой U+2212 MINUS SIGN, а не дефис', () => {
    expect(formatSigned(-2000)).toBe('−2 000')
    expect(formatSigned(-2000)).not.toContain('-')
  })

  it('оставляет ноль без знака', () => {
    expect(formatSigned(0)).toBe('0')
  })

  it('группирует длинные суммы по тысячам', () => {
    expect(formatSigned(1234567)).toBe('+1 234 567')
    expect(formatSigned(-1234567)).toBe('−1 234 567')
  })

  it('не группирует суммы меньше тысячи', () => {
    expect(formatSigned(999)).toBe('+999')
  })
})

// «Разовые ₽» и «Итого ₽» стоят рядом в одной строке, поэтому оба минуса должны
// быть одним и тем же символом — дефис здесь и U+2212 там читаются как два разных
// вида чисел.
describe('formatAmount', () => {
  it('группирует разряды по тысячам без знака', () => {
    expect(formatAmount(5000)).toBe('5 000')
    expect(formatAmount(1234567)).toBe('1 234 567')
  })

  it('выводит отрицательную сумму с U+2212 MINUS SIGN, а не с дефисом', () => {
    expect(formatAmount(-1900)).toBe('−1 900')
    expect(formatAmount(-1900)).not.toContain('-')
  })

  it('никогда не ставит + перед положительной суммой (колонка без знака)', () => {
    expect(formatAmount(999)).toBe('999')
    expect(formatAmount(0)).toBe('0')
  })

  it('использует тот же глиф минуса, что и formatSigned', () => {
    expect(formatAmount(-2000).slice(0, 1)).toBe(formatSigned(-2000).slice(0, 1))
  })
})
