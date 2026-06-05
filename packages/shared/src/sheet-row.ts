import type { Booking } from './booking.js'

export const EXPECTED_HEADERS = Object.freeze([
  'Дата',        // A
  'Время',       // B
  'Имя',         // C
  'Номер',       // D
  'Машина',      // E
  'Услуга',      // F
  'Примечание',  // G
  'Сумма, ₽',    // H
  'Готовность',  // I
  'Мастер',      // J
  'Ответсвенный',// K — typo preserved verbatim
] as const)

export function bookingToRow(b: Booking): (string | number)[] {
  // Cell A: single-day → bare dateFrom; multi-day → apostrophe-prefixed range (TEXT coercion)
  const cellA = b.dateTo === undefined
    ? b.dateFrom
    : "'" + b.dateFrom + '-' + b.dateTo

  // Cell H: amount — '' → '' (empty), number → number literal
  const cellH: string | number = b.amount === '' ? '' : b.amount

  return [
    cellA,              // A — Дата
    b.time,             // B — Время
    b.name,             // C — Имя
    b.phone,            // D — Номер
    b.car,              // E — Машина
    b.service,          // F — Услуга
    b.note,             // G — Примечание
    cellH,              // H — Сумма, ₽
    b.readiness,        // I — Готовность (always string post-parse; '' when blank)
    b.master,           // J — Мастер
    b.responsible,      // K — Ответсвенный (always string post-parse; '' when blank)
  ]
}
