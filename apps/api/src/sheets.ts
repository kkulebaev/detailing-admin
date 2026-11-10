import { google } from 'googleapis'
import { env } from './env.js'
import { EXPECTED_HEADERS } from '@detailing-admin/shared/sheet-row'
import { StatusCodes } from '@detailing-admin/shared'

export type AppendResult =
  | { ok: true; updatedRange: string; updatedRow: number; latencyMs: number; statusCode: number }
  | { ok: false; latencyMs: number; statusCode: number; errorCode?: string; message: string }

/** Извлекает номер строки в конце A1-диапазона вида "Sheet!A5" или "Sheet!A5:K5". */
function parseUpdatedRow(updatedRange: string): number {
  const tail = updatedRange.split(':').pop() ?? updatedRange
  const match = /[A-Z]+(\d+)$/.exec(tail)
  return match ? Number.parseInt(match[1], 10) : 0
}

// Ленивая инициализация: не декодируем учётные данные при загрузке модуля (облегчает тесты).
let _client: ReturnType<typeof google.sheets> | null = null

function getClient(): ReturnType<typeof google.sheets> {
  if (!_client) {
    const raw = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8')
    // GoogleAuth.credentials принимает обычный JSON-объект; мы не перестраиваем его
    // перед передачей, так что дефолтный `any` из `JSON.parse` здесь как раз подходит.
    const credentials: Record<string, unknown> = JSON.parse(raw)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    _client = google.sheets({ version: 'v4', auth })
  }
  return _client
}

/** Только для тестов — позволяет подставить mock-клиент. */
export function _setClientForTest(mock: ReturnType<typeof google.sheets>): void {
  _client = mock
}

export async function verifyHeaders(): Promise<
  { ok: true } | { ok: false; column_index: number; expected: string; observed: string }
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
    // googleapis бросает значения, похожие на GaxiosError, а catch типизирует их
    // как `unknown`. Сужаем каждое поле через `in` + typeof, а не утверждаем
    // самодельную форму ошибки.
    let statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR
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
