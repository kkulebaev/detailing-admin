/**
 * Dev-only: insert a handful of varied bookings straight into Postgres so the
 * `/bookings` page has data to show. Bypasses the API on purpose — the POST
 * route dual-writes to the authoritative Google Sheet, which must not get test
 * rows. Idempotent: fixed `idempotencyKey`s + onConflictDoNothing, so re-running
 * never duplicates.
 *
 *   pnpm --filter @detailing-admin/api exec tsx --env-file=.env scripts/seed-bookings-dev.ts
 */
import { bookingSchema } from '@detailing-admin/shared/booking'
import { insertBooking } from '../src/db/bookings.js'
import { closeDb } from '../src/db/client.js'

// Real master names from the local `masters` table so the master filter works.
const SAMPLES = [
  {
    key: 'dev-seed-01',
    payload: {
      dateFrom: '28.07.2026',
      time: '10:00',
      name: 'Алексей Смирнов',
      phone: '+79991234567',
      car: 'Toyota Camry',
      service: 'Полировка кузова',
      note: 'Царапина на левой двери',
      amount: 8000,
      readiness: 'Готова к выдаче',
      master: 'Дмитрий Глотов',
      responsible: 'Иван Содель',
      carClass: 3,
    },
  },
  {
    key: 'dev-seed-02',
    payload: {
      dateFrom: '30.07.2026',
      time: '12:30',
      name: 'Марина Кузнецова',
      phone: '8 (900) 111-22-33',
      car: 'Kia Rio',
      service: 'Химчистка салона',
      amount: 5500,
      readiness: 'В работе',
      master: 'Сергей Теплов',
      responsible: 'Иван Содель',
      carClass: 2,
    },
  },
  {
    key: 'dev-seed-03',
    payload: {
      dateFrom: '10.08.2026',
      dateTo: '12.08.2026',
      time: '09:00',
      timeTo: '18:00',
      name: 'Пётр Васильев',
      phone: '+79001112233',
      car: 'BMW X5',
      service: 'Оклейка антигравийной плёнкой',
      note: 'Многодневная работа, машина остаётся в боксе',
      amount: 120000,
      readiness: 'Подтвердил',
      master: 'Вячеслав Толстов',
      responsible: 'Иван Содель',
      carClass: 4,
    },
  },
  {
    key: 'dev-seed-04',
    payload: {
      dateFrom: '01.08.2026',
      time: '15:00',
      name: 'Ольга Соколова',
      phone: '89261234567',
      car: 'Lada Vesta',
      service: 'Комплекс: мойка + полироль + защита',
      amount: 7450,
      amountFormula: '=3000+3500+1200-250',
      readiness: 'Оплачено',
      master: 'Костя',
      responsible: 'Иван Содель',
      carClass: 1,
    },
  },
  {
    key: 'dev-seed-05',
    payload: {
      dateFrom: '05.08.2026',
      time: '11:00',
      name: 'Николай Фёдоров',
      phone: '+79995556677',
      car: 'Mercedes-Benz E-class',
      service:
        'Глубокая детейлинг-полировка в три этапа с керамическим покрытием кузова и обработкой стёкол — очень длинное описание для проверки переноса и обрезки текста в ячейке таблицы',
      note: 'Просил перезвонить за день до записи',
      amount: 45000,
      readiness: 'Не ответил',
      master: 'Андрей и ко.',
      responsible: 'Иван Содель',
      carClass: 3,
    },
  },
  {
    key: 'dev-seed-06',
    payload: {
      dateFrom: '02.08.2026',
      time: '17:30',
      name: 'Иван Петров',
      phone: '+79161234567',
      car: 'Hyundai Solaris',
      service: 'Мойка',
      amount: 1200,
      master: 'Иван Содель',
      responsible: 'Иван Содель',
      carClass: 2,
    },
  },
]

async function main() {
  let inserted = 0
  let skipped = 0
  for (const { key, payload } of SAMPLES) {
    const booking = bookingSchema.parse(payload)
    const ok = await insertBooking(booking, {
      idempotencyKey: key,
      clientId: null,
      sheetRow: null,
      sheetRange: null,
    })
    if (ok) inserted++
    else skipped++
    console.log(`${ok ? 'inserted' : 'skipped '} ${key}  ${payload.name} — ${payload.service.slice(0, 32)}`)
  }
  console.log(`\nDone: ${inserted} inserted, ${skipped} already present (${SAMPLES.length} total).`)
  await closeDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
