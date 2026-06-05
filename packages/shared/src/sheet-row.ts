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
  // Cell A: single-day → bare dateFrom; multi-day → apostrophe-prefixed range
  // including end time if provided (TEXT coercion under USER_ENTERED).
  //   single: "04.06.2026"
  //   range without end time: "'04.06.2026-05.06.2026"
  //   range with end time:    "'04.06.2026 10:00-05.06.2026 18:00"
  let cellA: string
  if (b.dateTo === undefined) {
    cellA = b.dateFrom
  } else {
    const startPart = b.time ? `${b.dateFrom} ${b.time}` : b.dateFrom
    const endPart = b.timeTo ? `${b.dateTo} ${b.timeTo}` : b.dateTo
    cellA = `'${startPart}-${endPart}`
  }

  // Cell H: amount — '' → '' (empty), number → number literal
  const cellH: string | number = b.amount === '' ? '' : b.amount

  return [
    cellA,              // A — Дата
    b.time,             // B — Время (start)
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
