import { assert, describe, it, expect } from 'vitest'
import { bookingToRow, EXPECTED_HEADERS } from '../src/sheet-row.js'
import { bookingSchema } from '../src/booking.js'
import type { Booking } from '../src/booking.js'

function parseBooking(input: Record<string, unknown>): Booking {
  const result = bookingSchema.safeParse(input)
  if (!result.success) throw new Error('Parse failed: ' + JSON.stringify(result.error.issues))
  return result.data
}

const baseInput = {
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

describe('EXPECTED_HEADERS', () => {
  it('содержит ровно 11 заголовков', () => {
    expect(EXPECTED_HEADERS.length).toBe(11)
  })

  it('колонка K (индекс 10) — Ответственный', () => {
    expect(EXPECTED_HEADERS[10]).toBe('Ответственный')
  })
})

describe('bookingToRow', () => {
  it('даёт ровно 11 ячеек', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row).toHaveLength(11)
  })

  it('один день: ячейка A — голая DD.MM.YYYY (без апострофа)', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[0]).toBe('04.06.2026')
    expect(String(row[0]).startsWith("'")).toBe(false)
  })

  it('несколько дней без времени окончания: ячейка A — "\'начало время-конец", время только у начала', () => {
    const booking = parseBooking({ ...baseInput, dateTo: '05.06.2026' })
    const row = bookingToRow(booking)
    expect(typeof row[0]).toBe('string')
    expect(String(row[0])).toBe("'04.06.2026 10:00-05.06.2026")
  })

  it('несколько дней со временем окончания: ячейка A содержит время и начала, и конца', () => {
    const booking = parseBooking({ ...baseInput, dateTo: '05.06.2026', timeTo: '18:30' })
    const row = bookingToRow(booking)
    expect(String(row[0])).toBe("'04.06.2026 10:00-05.06.2026 18:30")
  })

  it('ячейка D: телефон — TEXT, форсированный апострофом, во внутрироссийском виде 8XXXXXXXXXX', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[3]).toBe("'89991234567")
  })

  it('readiness undefined → пустая строка в ячейке I', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[8]).toBe('')
  })

  it('responsible из базового ввода пишется в ячейку K', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[10]).toBe('Иван Содель')
  })

  it('один мастер → в ячейке J голое имя', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[9]).toBe('Иван Содель')
  })

  it('несколько мастеров → ячейка J склеивает имена через ", "', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, master: ['Иван', 'Пётр'] }))
    expect(row[9]).toBe('Иван, Пётр')
  })

  it('сумма 200000 → число 200000 в ячейке H', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, amount: 200000 }))
    expect(row[7]).toBe(200000)
    expect(typeof row[7]).toBe('number')
  })

  it('amountFormula → пишется в ячейку H как есть вместо числа', () => {
    const row = bookingToRow(
      parseBooking({ ...baseInput, amount: 5050, amountFormula: '=2000+3000-950' }),
    )
    expect(row[7]).toBe('=2000+3000-950')
  })

  it('отклоняет amountFormula с неарифметической функцией Sheets', () => {
    const result = bookingSchema.safeParse({ ...baseInput, amountFormula: '=IMPORTRANGE("x","y")' })
    expect(result.success).toBe(false)
  })

  // Эталон: перенос склейки car+plate на сервер (joinCar) не должен менять
  // байты колонки E при том же вводе. Без plate — голый car, как раньше.
  it('ячейка E: без номера побайтово совпадает с голой машиной', () => {
    const row = bookingToRow(parseBooking(baseInput))
    expect(row[4]).toBe('Toyota Camry')
  })

  it('ячейка E: с номером склеивается как "car, plate"', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, plate: 'А123АА77' }))
    expect(row[4]).toBe('Toyota Camry, А123АА77')
  })

  it('ячейка E: с пустым номером побайтово совпадает с голой машиной (без хвостового ", ")', () => {
    const row = bookingToRow(parseBooking({ ...baseInput, plate: '' }))
    expect(row[4]).toBe('Toyota Camry')
  })

  it('bookingSchema принимает plate', () => {
    const result = bookingSchema.safeParse({ ...baseInput, plate: 'А123АА77' })
    assert(result.success)
    expect(result.data.plate).toBe('А123АА77')
  })
})
