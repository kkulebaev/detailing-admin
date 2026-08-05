/**
 * One-shot enrichment: populate `client_cars` from the "Запись 2026" sheet tab.
 *
 *   pnpm --filter @detailing-admin/api backfill:client-cars-sheet
 *
 * The going-forward ingest (`upsertClientCar` on each booking) is recent, so the
 * historical car registry was near-empty. The sheet is the source of truth and
 * carries phone (col D) + car (col E) for every booking, so we read it, resolve
 * each phone to an existing client, and upsert the car. Idempotent:
 * `upsertClientCar` is `onConflictDoNothing` on the normalized (client, make, plate)
 * key, so a re-run inserts nothing new. Read-only against the sheet.
 *
 * Scope: the "Запись 2026" tab only (matches the DB mirror's coverage). Rows whose
 * phone doesn't resolve to a known client are skipped (no client to own the car);
 * clients are already seeded from the same sheet. Run `backfill:car-ids` afterwards
 * to link `bookings.car_id` against the freshly populated cars.
 */
import { google } from 'googleapis'
import { normalizePhone } from '@detailing-admin/shared/phone'
import { env } from '../src/env.js'
import { getSql, closeDb } from '../src/db/client.js'
import { upsertClientCar } from '../src/db/client-cars.js'

function buildSheetsClient(): ReturnType<typeof google.sheets> {
  const raw = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8')
  const credentials = JSON.parse(raw) as Record<string, unknown>
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

/**
 * Reverse of `joinCar` for historical data: the make/model and an optional plate
 * were joined with ", ". Split on the LAST ", " so a make/model containing a comma
 * stays intact and the tail is the plate; no ", " → the whole string is the
 * make/model with an empty plate (the common case — most rows carry no plate).
 */
export function splitCar(joined: string): { makeModel: string; plate: string } {
  const idx = joined.lastIndexOf(', ')
  if (idx < 0) return { makeModel: joined.trim(), plate: '' }
  return { makeModel: joined.slice(0, idx).trim(), plate: joined.slice(idx + 2).trim() }
}

export interface SheetCarBackfillResult {
  rowsScanned: number
  carsUpserted: number
  clientCarsAdded: number
  skippedNoCar: number
  skippedBadPhone: number
  skippedNoClient: number
}

export async function backfillClientCarsFromSheet(): Promise<SheetCarBackfillResult> {
  const sheets = buildSheetsClient()
  const tab = env.SHEET_NAME
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.SPREADSHEET_ID,
    range: `${tab}!A1:K`,
  })
  const rows = res.data.values ?? []
  const header = rows[0] ?? []
  // Byte-exact header contract (see EXPECTED_HEADERS): D=Номер, E=Машина.
  if (String(header[3]) !== 'Номер' || String(header[4]) !== 'Машина') {
    throw new Error(`Unexpected sheet headers on "${tab}": D=${header[3]}, E=${header[4]}`)
  }

  const sql = getSql()
  const clients = await sql<{ id: string; phone: string }[]>`SELECT id, phone FROM clients`
  const phoneToId = new Map(clients.map((c) => [c.phone, c.id]))

  const before = Number((await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM client_cars`)[0].c)

  const r: SheetCarBackfillResult = {
    rowsScanned: 0,
    carsUpserted: 0,
    clientCarsAdded: 0,
    skippedNoCar: 0,
    skippedBadPhone: 0,
    skippedNoClient: 0,
  }

  for (const row of rows.slice(1)) {
    r.rowsScanned++
    const carRaw = String(row[4] ?? '').trim()
    if (!carRaw) {
      r.skippedNoCar++
      continue
    }
    let phone: string
    try {
      phone = normalizePhone(String(row[3] ?? ''))
    } catch {
      r.skippedBadPhone++
      continue
    }
    if (!phone) {
      r.skippedBadPhone++
      continue
    }
    const clientId = phoneToId.get(phone)
    if (!clientId) {
      r.skippedNoClient++
      continue
    }
    const { makeModel, plate } = splitCar(carRaw)
    await upsertClientCar(clientId, makeModel, plate)
    r.carsUpserted++
  }

  const after = Number((await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM client_cars`)[0].c)
  r.clientCarsAdded = after - before
  return r
}

async function main(): Promise<void> {
  const r = await backfillClientCarsFromSheet()
  console.log(`✓ rows scanned: ${r.rowsScanned}`)
  console.log(`✓ cars upserted (resolved to a client): ${r.carsUpserted}`)
  console.log(`✓ new client_cars rows: ${r.clientCarsAdded}`)
  console.log(
    `  skipped — no car: ${r.skippedNoCar}, bad/empty phone: ${r.skippedBadPhone}, no matching client: ${r.skippedNoClient}`,
  )
  console.log('  → now run `backfill:car-ids` to link bookings.car_id')
  await closeDb()
}

// Only run when executed directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
