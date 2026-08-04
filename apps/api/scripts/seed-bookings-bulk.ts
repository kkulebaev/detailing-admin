/**
 * Dev-only: bulk-insert N generated bookings straight into Postgres to load-test
 * the /bookings table (pagination, month filter, wide data). Like
 * seed-bookings-dev.ts it bypasses the API (no Sheets writes) and is idempotent:
 * deterministic per-index data + fixed `dev-bulk-NNN` keys + onConflictDoNothing,
 * so re-running never duplicates.
 *
 *   pnpm --filter @detailing-admin/api exec tsx --env-file=.env scripts/seed-bookings-bulk.ts [count]
 *
 * `count` defaults to 100.
 */
import { bookingSchema } from '@detailing-admin/shared/booking'
import { formatDdmmyyyy } from '@detailing-admin/shared/date'
import { READINESS } from '@detailing-admin/shared/enums'
import { insertBooking } from '../src/db/bookings.js'
import { closeDb } from '../src/db/client.js'

const FIRST = [
  'Алексей', 'Марина', 'Пётр', 'Ольга', 'Николай', 'Иван', 'Екатерина', 'Дмитрий',
  'Анна', 'Сергей', 'Юлия', 'Максим', 'Наталья', 'Андрей', 'Светлана',
]
const LAST = [
  'Смирнов', 'Кузнецова', 'Васильев', 'Соколова', 'Фёдоров', 'Петров', 'Морозова',
  'Волков', 'Егорова', 'Козлов', 'Новикова', 'Орлов', 'Тихонова', 'Лебедев', 'Зайцева',
]
const CARS = [
  'Toyota Camry', 'Kia Rio', 'BMW X5', 'Lada Vesta', 'Mercedes-Benz E-class',
  'Hyundai Solaris', 'Volkswagen Polo', 'Audi A4', 'Skoda Octavia', 'Nissan X-Trail',
  'Mazda CX-5', 'Renault Duster', 'Ford Focus', 'Honda CR-V', 'Chevrolet Cruze',
]
// Mix of single-line and multi-line (per-section) services.
const SERVICES = [
  'Мойка',
  'Химчистка: Салон',
  'Полировка: Кузов\nЗащита: Стекло',
  'Мойка: Кузов, Диски\nПолировка: Кузов\nЗащита: Керамика',
  'Оклейка антигравийной плёнкой',
  'Химчистка: Потолок, Сиденья\nМойка: Кузов',
  'Комплексная детейлинг-полировка',
  'Тонировка: Задняя полусфера',
]
const MASTERS = [
  'Дмитрий Глотов', 'Сергей Теплов', 'Вячеслав Толстов', 'Иван Содель', 'Андрей и ко.', 'Костя',
]
const TIMES = ['09:00', '10:00', '10:30', '11:00', '12:30', '14:00', '15:00', '16:30', '17:30', '18:00']

function makePayload(i: number) {
  // Spread ~7 months from 2026-02-01 so the month filter has data across months.
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
    // Every 7th row has a blank readiness to exercise the «—» rendering.
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
