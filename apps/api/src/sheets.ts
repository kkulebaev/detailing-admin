import { google } from 'googleapis'
import { env } from './env.js'
import { EXPECTED_HEADERS } from '@detailing-admin/shared/sheet-row'

export type AppendResult =
  | { ok: true; updatedRange: string; updatedRow: number; latencyMs: number; statusCode: number }
  | { ok: false; latencyMs: number; statusCode: number; errorCode?: string; message: string }

/** Extract the trailing row number from an A1 range like "Sheet!A5" or "Sheet!A5:K5". */
function parseUpdatedRow(updatedRange: string): number {
  const tail = updatedRange.split(':').pop() ?? updatedRange
  const match = /[A-Z]+(\d+)$/.exec(tail)
  return match ? Number.parseInt(match[1], 10) : 0
}

// Lazy-init to avoid decoding credentials at module load (aids testing).
let _client: ReturnType<typeof google.sheets> | null = null

function getClient(): ReturnType<typeof google.sheets> {
  if (!_client) {
    const raw = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8')
    const credentials = JSON.parse(raw) as Record<string, unknown>
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    _client = google.sheets({ version: 'v4', auth })
  }
  return _client
}

/** For tests only — lets tests inject a mock client. */
export function _setClientForTest(mock: ReturnType<typeof google.sheets>): void {
  _client = mock
}

export async function verifyHeaders(): Promise<
  | { ok: true }
  | { ok: false; column_index: number; expected: string; observed: string }
> {
  const client = getClient()
  const range = `${env.SHEET_NAME}!A1:K1`
  const res = await client.spreadsheets.values.get({
    spreadsheetId: env.SPREADSHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  const row: unknown[] = res.data.values?.[0] ?? []
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    const expected = EXPECTED_HEADERS[i] as string
    const observed = String(row[i] ?? '')
    if (observed !== expected) {
      return { ok: false, column_index: i, expected, observed }
    }
  }
  return { ok: true }
}

export async function appendBooking(row: (string | number)[]): Promise<AppendResult> {
  const client = getClient()
  const range = `${env.SHEET_NAME}!A1`
  const start = Date.now()
  try {
    const res = await client.spreadsheets.values.append({
      spreadsheetId: env.SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    })
    const updatedRange = res.data.updates?.updatedRange ?? range
    return {
      ok: true,
      updatedRange,
      updatedRow: parseUpdatedRow(updatedRange),
      latencyMs: Date.now() - start,
      statusCode: res.status,
    }
  } catch (err: unknown) {
    const e = err as { code?: number; errors?: Array<{ reason?: string }>; message?: string }
    return {
      ok: false,
      latencyMs: Date.now() - start,
      statusCode: e.code ?? 500,
      errorCode: e.errors?.[0]?.reason,
      message: e.message ?? 'Unknown Sheets error',
    }
  }
}
