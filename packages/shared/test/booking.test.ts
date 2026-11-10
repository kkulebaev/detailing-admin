import { assert, describe, it, expect } from 'vitest'
import { bookingSchema } from '../src/booking.js'

const validBase = {
  dateFrom: '04.06.2026',
  time: '10:00',
  name: 'Иван',
  phone: '+79991234567',
  car: 'Toyota Camry',
  service: 'Полировка',
  amount: 5000,
  master: ['Иван Содель'],
  responsible: 'Иван Содель',
  carClass: 3,
}

describe('bookingSchema', () => {
  it('разбирает валидный минимальный payload', () => {
    const result = bookingSchema.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  it('отклоняет неверное время 25:99', () => {
    const result = bookingSchema.safeParse({ ...validBase, time: '25:99' })
    expect(result.success).toBe(false)
  })

  it('отклоняет неверное время 24:00', () => {
    const result = bookingSchema.safeParse({ ...validBase, time: '24:00' })
    expect(result.success).toBe(false)
  })

  it('отклоняет неверный формат даты', () => {
    const result = bookingSchema.safeParse({ ...validBase, dateFrom: '2026-06-04' })
    expect(result.success).toBe(false)
  })

  it('transform телефона дает канонический вид E.164', () => {
    const result = bookingSchema.safeParse({ ...validBase, phone: '8 999 123 45 67' })
    assert(result.success)
    expect(result.data.phone).toBe('+79991234567')
  })

  it('мусор в телефоне дает ZodIssue по пути ["phone"]', () => {
    const result = bookingSchema.safeParse({ ...validBase, phone: '123' })
    assert(!result.success)
    const phoneIssue = result.error.issues.find(
      (i) => JSON.stringify(i.path) === JSON.stringify(['phone']),
    )
    expect(phoneIssue).toBeDefined()
    expect(result.error.issues).toHaveLength(1)
  })

  it('отклоняет dateTo < dateFrom через границу года', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      dateFrom: '02.01.2026',
      dateTo: '30.12.2025',
    })
    expect(result.success).toBe(false)
  })

  it('принимает dateTo > dateFrom через границу года', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      dateFrom: '30.12.2025',
      dateTo: '02.01.2026',
    })
    expect(result.success).toBe(true)
  })

  it('схлопывает dateFrom === dateTo в dateTo: undefined', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      dateFrom: '04.06.2026',
      dateTo: '04.06.2026',
    })
    assert(result.success)
    expect(result.data.dateTo).toBeUndefined()
  })

  it('отклоняет сумму в виде пустой строки', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: '' })
    expect(result.success).toBe(false)
  })

  it('принимает сумму 200000', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: 200000 })
    expect(result.success).toBe(true)
  })

  it('отклоняет отрицательную сумму', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: -1 })
    expect(result.success).toBe(false)
  })

  it('принимает сумму выше прежнего потолка 10M (скрытого верхнего предела нет)', () => {
    const result = bookingSchema.safeParse({ ...validBase, amount: 25_000_000 })
    assert(result.success)
    expect(result.data.amount).toBe(25_000_000)
  })

  it('readiness: принимает явную пустую строку', () => {
    const result = bookingSchema.safeParse({ ...validBase, readiness: '' })
    assert(result.success)
    expect(result.data.readiness).toBe('')
  })

  it('readiness: принимает валидное значение enum', () => {
    const result = bookingSchema.safeParse({ ...validBase, readiness: 'Выдана' })
    assert(result.success)
    expect(result.data.readiness).toBe('Выдана')
  })

  it('readiness: по умолчанию пустая строка, если не передано', () => {
    const result = bookingSchema.safeParse(validBase)
    assert(result.success)
    expect(result.data.readiness).toBe('')
  })

  it('принимает произвольное имя мастера вне прежнего enum', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      master: ['Петр Новый'],
      responsible: 'Петр Новый',
    })
    expect(result.success).toBe(true)
  })

  it('принимает несколько мастеров', () => {
    const result = bookingSchema.safeParse({ ...validBase, master: ['Иван', 'Петр'] })
    assert(result.success)
    expect(result.data.master).toEqual(['Иван', 'Петр'])
  })

  it('убирает повторы мастеров, сохраняя порядок первого вхождения', () => {
    const result = bookingSchema.safeParse({ ...validBase, master: ['Петр', 'Иван', 'Петр'] })
    assert(result.success)
    expect(result.data.master).toEqual(['Петр', 'Иван'])
  })

  it('отклоняет больше MAX_MASTERS мастеров', () => {
    const result = bookingSchema.safeParse({
      ...validBase,
      master: ['А', 'Б', 'В', 'Г', 'Д', 'Е'],
    })
    expect(result.success).toBe(false)
  })

  it('отклоняет имя мастера, начинающее формулу (защита от инъекций)', () => {
    const result = bookingSchema.safeParse({ ...validBase, master: ['=SUM(A1)'] })
    expect(result.success).toBe(false)
  })

  it('master: отклоняет пустой массив', () => {
    const result = bookingSchema.safeParse({ ...validBase, master: [] })
    expect(result.success).toBe(false)
  })

  it('responsible: отклоняет явную пустую строку', () => {
    const result = bookingSchema.safeParse({ ...validBase, responsible: '' })
    expect(result.success).toBe(false)
  })

  it('responsible: отклоняет отсутствующее значение с тем же сообщением, что и пустое', () => {
    const { responsible: _omit, ...withoutResponsible } = validBase
    const result = bookingSchema.safeParse(withoutResponsible)
    assert(!result.success)
    expect(result.error.issues[0]?.message).toBe('Выберите ответственного')
  })

  it('отклоняет поле времени длиннее 5 символов, даже если regex иначе бы совпал', () => {
    const result = bookingSchema.safeParse({ ...validBase, time: '010:00' })
    expect(result.success).toBe(false)
  })

  it('отклоняет dateFrom длиннее 10 символов, даже если regex иначе бы совпал', () => {
    const result = bookingSchema.safeParse({ ...validBase, dateFrom: '004.06.2026' })
    expect(result.success).toBe(false)
  })
})
