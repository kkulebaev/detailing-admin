/**
 * Только для разработки: массово вставляет N сгенерированных записей прямо в Postgres,
 * чтобы нагрузочно проверить таблицу /bookings (пагинация, фильтр по месяцу, широкие
 * данные). Как и seed-bookings-dev.ts, обходит API (без записи в Sheets) и идемпотентен:
 * детерминированные данные по индексу + фиксированные ключи `dev-bulk-NNN` +
 * onConflictDoNothing, поэтому повторный запуск не создает дублей.
 *
 *   pnpm --filter @detailing-admin/api exec tsx --env-file=.env scripts/seed-bookings-bulk.ts [count]
 *
 * `count` по умолчанию — 100.
 */
import { bookingSchema } from '@detailing-admin/shared/booking'
import { formatDdmmyyyy } from '@detailing-admin/shared/date'
import { READINESS } from '@detailing-admin/shared/enums'
import { insertBooking } from '../src/db/bookings.js'
import { closeDb } from '../src/db/client.js'

const FIRST = [
  'Алексей',
  'Марина',
  'Петр',
  'Ольга',
  'Николай',
  'Иван',
  'Екатерина',
  'Дмитрий',
  'Анна',
  'Сергей',
  'Юлия',
  'Максим',
  'Наталья',
  'Андрей',
  'Светлана',
]
const LAST = [
  'Смирнов',
  'Кузнецова',
  'Васильев',
  'Соколова',
  'Федоров',
  'Петров',
  'Морозова',
  'Волков',
  'Егорова',
  'Козлов',
  'Новикова',
  'Орлов',
  'Тихонова',
  'Лебедев',
  'Зайцева',
]
const CARS = [
  'Toyota Camry',
  'Kia Rio',
  'BMW X5',
  'Lada Vesta',
  'Mercedes-Benz E-class',
  'Hyundai Solaris',
  'Volkswagen Polo',
  'Audi A4',
  'Skoda Octavia',
  'Nissan X-Trail',
  'Mazda CX-5',
  'Renault Duster',
  'Ford Focus',
  'Honda CR-V',
  'Chevrolet Cruze',
]
// Смесь однострочных и многострочных (по разделам) услуг.
const SERVICES = [
  'Мойка',
  'Химчистка: Салон',
  'Полировка: Кузов\nЗащита: Стекло',
  'Мойка: Кузов, Диски\nПолировка: Кузов\nЗащита: Керамика',
  'Оклейка антигравийной пленкой',
  'Химчистка: Потолок, Сиденья\nМойка: Кузов',
  'Комплексная детейлинг-полировка',
  'Тонировка: Задняя полусфера',
]
const MASTERS = [
  'Дмитрий Глотов',
  'Сергей Теплов',
  'Вячеслав Толстов',
  'Иван Содель',
  'Андрей и ко.',
  'Костя',
]
const TIMES = [
  '09:00',
  '10:00',
  '10:30',
  '11:00',
  '12:30',
  '14:00',
  '15:00',
  '16:30',
  '17:30',
  '18:00',
]

function makePayload(i: number) {
  // Разброс на ~7 месяцев от 2026-02-01, чтобы у фильтра по месяцу были данные в разных месяцах.
  const base = new Date(Date.UTC(2026, 1, 1))
  base.setUTCDate(base.getUTCDate() + ((i * 3) % 210))
  const dateFrom = formatDdmmyyyy(base)

  const multiDay = i % 12 === 0
  let dateTo: string | undefined
  let timeTo: string | undefined
  if (multiDay) {
    const end = new Date(base)
    end.setUTCDate(end.getUTCDate() + 2)
    dateTo = formatDdmmyyyy(end)
    timeTo = '18:00'
  }

  const amount = 1000 + (i % 24) * 500
  const withFormula = i % 9 === 0

  return {
    dateFrom,
    ...(dateTo ? { dateTo } : {}),
    time: TIMES[i % TIMES.length],
    ...(timeTo ? { timeTo } : {}),
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
    phone: `+79${String(i).padStart(9, '0')}`,
    car: CARS[i % CARS.length],
    service: SERVICES[i % SERVICES.length],
    amount,
    ...(withFormula ? { amountFormula: `=${amount - 500}+500` } : {}),
    // У каждой 7-й строки пустая готовность, чтобы проверить отображение «—».
    readiness: i % 7 === 0 ? '' : READINESS[i % READINESS.length],
    master: [MASTERS[i % MASTERS.length]],
    responsible: MASTERS[(i + 1) % MASTERS.length],
    carClass: ((i % 4) + 1) as 1 | 2 | 3 | 4,
  }
}

async function main() {
  const count = Number.parseInt(process.argv[2] ?? '100', 10)
  if (!Number.isFinite(count) || count < 1) {
    console.error(`Invalid count: ${process.argv[2]}`)
    process.exit(1)
  }

  let inserted = 0
  let skipped = 0
  for (let i = 1; i <= count; i++) {
    const booking = bookingSchema.parse(makePayload(i))
    const ok = await insertBooking(booking, {
      idempotencyKey: `dev-bulk-${String(i).padStart(3, '0')}`,
      clientId: null,
      carId: null,
      sheetRow: null,
      sheetRange: null,
    })
    if (ok) inserted++
    else skipped++
  }
  console.log(`Done: ${inserted} inserted, ${skipped} already present (${count} requested).`)
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
