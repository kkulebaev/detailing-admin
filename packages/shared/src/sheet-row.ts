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
  'Ответственный',// K
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

  // Cell D: «Номер» carries a strict validation rule
  //   =REGEXMATCH(TO_TEXT(D); "^8\d{10}$")
  // so the phone must be the domestic 8XXXXXXXXXX form (11 digits, leading 8),
  // not the canonical +7XXXXXXXXXX. Convert it and force TEXT with a leading
  // apostrophe (a marker — consumed, not shown) so it lands as a string the
  // rule accepts, e.g. «89991234567».
  const phoneCell = b.phone ? `'${b.phone.replace(/^\+7/, '8')}` : ''

  return [
    cellA,              // A — Дата
    b.time,             // B — Время (start)
    b.name,             // C — Имя
    phoneCell,          // D — Номер
    b.car,              // E — Машина
    b.service,          // F — Услуга
    b.note,             // G — Примечание
    b.amount,           // H — Сумма, ₽
    b.readiness,        // I — Готовность (always string post-parse; '' when blank)
    b.master,           // J — Мастер
    b.responsible,      // K — Ответственный (always string post-parse; '' when blank)
  ]
}
