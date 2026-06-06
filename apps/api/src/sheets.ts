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
    // GoogleAuth.credentials accepts a plain JSON object; we don't reshape it
    // before handing off, so `JSON.parse`'s default `any` is what we want here.
    const credentials: Record<string, unknown> = JSON.parse(raw)
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
    const expected = EXPECTED_HEADERS[i]
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
    // googleapis throws GaxiosError-like values typed as `unknown` by the
    // catch. Narrow each field with `in` + typeof instead of asserting a
    // bespoke error shape.
    let statusCode = 500
    let errorCode: string | undefined
    let message = 'Unknown Sheets error'
    if (err !== null && typeof err === 'object') {
      if ('code' in err && typeof err.code === 'number') statusCode = err.code
      if ('errors' in err && Array.isArray(err.errors)) {
        const first: unknown = err.errors[0]
        if (
          first !== null &&
          typeof first === 'object' &&
          'reason' in first &&
          typeof first.reason === 'string'
        ) {
          errorCode = first.reason
        }
      }
      if ('message' in err && typeof err.message === 'string') message = err.message
    }
    return { ok: false, latencyMs: Date.now() - start, statusCode, errorCode, message }
  }
}
