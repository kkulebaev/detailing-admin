import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { google } from 'googleapis'
import { env } from '../src/env.js'
import { normalizePhone } from '@detailing-admin/shared/phone'

interface SeedEntry {
  phone: string
  name: string
}

interface InvalidPhone {
  tab: string
  row: number
  raw_phone: string
  name: string
  error: string
}

interface InvalidReport {
  generated_at: string
  spreadsheet_id: string
  invalid_phones: InvalidPhone[]
}

interface DumpResult {
  generated_at: string
  spreadsheet_id: string
  tabs_scanned: { title: string; rows_data: number; name_col: number; phone_col: number }[]
  tabs_skipped: { title: string; reason: string }[]
  totals: {
    rows_total: number
    invalid_phones: number
    empty_phones: number
    unique_clients: number
  }
  entries: SeedEntry[]
}

const OUT_PATH = resolve(import.meta.dirname, '../.seed/clients.json')
const INVALID_PATH = resolve(import.meta.dirname, '../.seed/invalid-phones.json')

function buildSheetsClient(): ReturnType<typeof google.sheets> {
  const raw = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8')
  const credentials = JSON.parse(raw) as Record<string, unknown>
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

/** Older sheets ("Запись 2024") → 2024. Untitled / unparseable → -Infinity (oldest). */
function yearOf(title: string): number {
  const m = /(\d{4})/.exec(title)
  return m ? Number.parseInt(m[1] as string, 10) : Number.NEGATIVE_INFINITY
}

function findHeaderIndex(headerRow: unknown[], candidates: string[]): number {
  const lower = headerRow.map((cell) => String(cell ?? '').trim().toLowerCase())
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate.toLowerCase())
    if (idx !== -1) return idx
  }
  return -1
}

async function main(): Promise<void> {
  const client = buildSheetsClient()
  const meta = await client.spreadsheets.get({ spreadsheetId: env.SPREADSHEET_ID })
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .filter((t) => t.length > 0)
    .sort((a, b) => yearOf(b) - yearOf(a))

  const phoneToEntry = new Map<string, SeedEntry>()
  const invalidPhones: InvalidPhone[] = []
  const result: DumpResult = {
    generated_at: new Date().toISOString(),
    spreadsheet_id: env.SPREADSHEET_ID,
    tabs_scanned: [],
    tabs_skipped: [],
    totals: { rows_total: 0, invalid_phones: 0, empty_phones: 0, unique_clients: 0 },
    entries: [],
  }

  for (const title of titles) {
    // Fetch the whole tab — header (row 1) + data
    const res = await client.spreadsheets.values.get({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `'${title.replace(/'/g, "''")}'`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    })
    const rows = res.data.values ?? []
    if (rows.length < 2) {
      result.tabs_skipped.push({ title, reason: 'empty or header-only' })
      continue
    }
    const header = rows[0] as unknown[]
    const nameCol = findHeaderIndex(header, ['Имя'])
    const phoneCol = findHeaderIndex(header, ['Номер', 'Телефон', 'Номер телефона'])
    if (nameCol === -1 || phoneCol === -1) {
      result.tabs_skipped.push({
        title,
        reason: `missing required header (name=${nameCol}, phone=${phoneCol})`,
      })
      continue
    }

    const dataRows = rows.slice(1)
    result.tabs_scanned.push({
      title,
      rows_data: dataRows.length,
      name_col: nameCol,
      phone_col: phoneCol,
    })
    result.totals.rows_total += dataRows.length

    // Bottom-up: newest entries first
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const row = dataRows[i] as unknown[]
      const rawPhone = String(row[phoneCol] ?? '').trim()
      const rawName = String(row[nameCol] ?? '').trim()

      if (rawPhone.length === 0) {
        result.totals.empty_phones++
        continue
      }
      let phone: string
      try {
        phone = normalizePhone(rawPhone)
      } catch (err) {
        result.totals.invalid_phones++
        invalidPhones.push({
          tab: title,
          row: i + 2, // +1 for header, +1 to make 1-indexed
          raw_phone: rawPhone,
          name: rawName,
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      if (phone.length === 0) {
        result.totals.empty_phones++
        continue
      }
      if (phoneToEntry.has(phone)) continue
      phoneToEntry.set(phone, { phone, name: rawName })
    }
  }

  result.entries = [...phoneToEntry.values()]
  result.totals.unique_clients = result.entries.length

  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf-8')

  const invalidReport: InvalidReport = {
    generated_at: result.generated_at,
    spreadsheet_id: result.spreadsheet_id,
    invalid_phones: invalidPhones,
  }
  await writeFile(INVALID_PATH, JSON.stringify(invalidReport, null, 2) + '\n', 'utf-8')

  console.log(`✓ Wrote ${result.entries.length} unique clients → ${OUT_PATH}`)
  console.log(`  scanned tabs: ${result.tabs_scanned.map((t) => t.title).join(', ') || '∅'}`)
  if (result.tabs_skipped.length > 0) {
    console.log(`  skipped tabs:`)
    for (const t of result.tabs_skipped) console.log(`    - ${t.title}: ${t.reason}`)
  }
  console.log(
    `  rows seen: ${result.totals.rows_total} (empty phones: ${result.totals.empty_phones}, invalid: ${result.totals.invalid_phones})`,
  )
  console.log(`✓ Wrote ${invalidPhones.length} invalid phones → ${INVALID_PATH}`)
  if (invalidPhones.length > 0) {
    console.log('\n--- Invalid phones ---')
    for (const p of invalidPhones) {
      console.log(`  [${p.tab} row ${p.row}] "${p.raw_phone}"  name="${p.name}"  (${p.error})`)
    }
  }
}

await main()
