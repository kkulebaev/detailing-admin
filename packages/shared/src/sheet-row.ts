import type { Booking } from './booking.js'
import { joinCar } from './car.js'

export const EXPECTED_HEADERS = Object.freeze([
  'Дата', // A
  'Время', // B
  'Имя', // C
  'Номер', // D
  'Машина', // E
  'Услуга', // F
  'Примечание', // G
  'Сумма, ₽', // H
  'Готовность', // I
  'Мастер', // J
  'Ответственный', // K
] as const)

export function bookingToRow(b: Booking): (string | number)[] {
  // Ячейка A: один день → голый dateFrom; несколько дней → диапазон с апострофом
  // в начале, со временем окончания, если оно задано (приведение к TEXT под USER_ENTERED).
  //   один день: "04.06.2026"
  //   диапазон без времени конца: "'04.06.2026-05.06.2026"
  //   диапазон со временем конца: "'04.06.2026 10:00-05.06.2026 18:00"
  let cellA: string
  if (b.dateTo === undefined) {
    cellA = b.dateFrom
  } else {
    const startPart = b.time ? `${b.dateFrom} ${b.time}` : b.dateFrom
    const endPart = b.timeTo ? `${b.dateTo} ${b.timeTo}` : b.dateTo
    cellA = `'${startPart}-${endPart}`
  }

  // Ячейка D: на «Номер» стоит строгое правило проверки
  //   =REGEXMATCH(TO_TEXT(D); "^8\d{10}$")
  // поэтому телефон должен быть во внутрироссийском виде 8XXXXXXXXXX (11 цифр, в начале 8),
  // а не в каноническом +7XXXXXXXXXX. Переводим его и форсируем TEXT ведущим
  // апострофом (это маркер — он поглощается, а не отображается), чтобы значение
  // легло строкой, которую правило принимает, напр. «89991234567».
  const phoneCell = b.phone ? `'${b.phone.replace(/^\+7/, '8')}` : ''

  return [
    cellA, // A — Дата
    b.time, // B — Время (начало)
    b.name, // C — Имя
    phoneCell, // D — Номер
    joinCar(b.car, b.plate), // E — Машина (марка/модель + гос. номер)
    b.service, // F — Услуга
    b.note, // G — Примечание
    // H — Сумма, ₽: арифметическая формула (Sheets вычисляет ее под
    // USER_ENTERED), если клиент ее прислал, иначе голое число.
    b.amountFormula ?? b.amount,

    b.readiness, // I — Готовность (после парсинга всегда строка; '' если пусто)
    b.master.join(', '), // J — Мастер (N мастеров через «, »)
    b.responsible, // K — Ответственный (после парсинга всегда строка; '' если пусто)
  ]
}
