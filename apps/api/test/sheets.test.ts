import { assert, describe, it, expect, vi, beforeEach } from 'vitest'
import type { sheets_v4 } from 'googleapis'
import { EXPECTED_HEADERS } from '@detailing-admin/shared/sheet-row'

// Мокаем env до импорта sheets
vi.mock('../src/env.js', () => ({
  env: {
    PORT: 3000,
    SPREADSHEET_ID: 'test-spreadsheet-id',
    SHEET_NAME: 'Запись 2026',
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from('{"type":"service_account"}').toString('base64'),
    WEB_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
  },
}))

import { verifyHeaders, appendBooking, _setClientForTest } from '../src/sheets.js'

type MockSheetsClient = {
  spreadsheets: {
    values: {
      get: ReturnType<typeof vi.fn>
      append: ReturnType<typeof vi.fn>
    }
  }
}

function makeMockClient(): MockSheetsClient {
  return {
    spreadsheets: {
      values: {
        get: vi.fn(),
        append: vi.fn(),
      },
    },
  }
}

describe('verifyHeaders', () => {
  let mock: MockSheetsClient

  beforeEach(() => {
    mock = makeMockClient()
    _setClientForTest(mock as unknown as ReturnType<typeof import('googleapis').google.sheets>)
  })

  it('возвращает ok:true, если заголовки точно совпадают с EXPECTED_HEADERS', async () => {
    mock.spreadsheets.values.get.mockResolvedValue({
      data: { values: [[...EXPECTED_HEADERS]] },
      status: 200,
    })
    const result = await verifyHeaders()
    expect(result.ok).toBe(true)
  })

  it('возвращает ok:false с верным column_index, если один заголовок изменён', async () => {
    const mutated = [...EXPECTED_HEADERS] as string[]
    mutated[8] = 'Готовнсть' // опечатка в столбце I
    mock.spreadsheets.values.get.mockResolvedValue({
      data: { values: [mutated] },
      status: 200,
    })
    const result = await verifyHeaders()
    assert(!result.ok)
    expect(result.column_index).toBe(8)
    expect(result.expected).toBe('Готовность')
    expect(result.observed).toBe('Готовнсть')
  })

  it('возвращает ok:false, если строка пустая (все заголовки отсутствуют)', async () => {
    mock.spreadsheets.values.get.mockResolvedValue({
      data: { values: [[]] },
      status: 200,
    })
    const result = await verifyHeaders()
    assert(!result.ok)
    expect(result.column_index).toBe(0)
  })
})

describe('appendBooking', () => {
  let mock: MockSheetsClient

  beforeEach(() => {
    mock = makeMockClient()
    _setClientForTest(mock as unknown as ReturnType<typeof import('googleapis').google.sheets>)
  })

  it('при успехе возвращает ok:true с updatedRange', async () => {
    mock.spreadsheets.values.append.mockResolvedValue({
      data: { updates: { updatedRange: 'Запись 2026!A5' } },
      status: 200,
    })
    const result = await appendBooking(['04.06.2026', '10:00', '', '', '', '', '', '', '', '', ''])
    assert(result.ok)
    expect(result.updatedRange).toBe('Запись 2026!A5')
    expect(result.updatedRow).toBe(5)
    expect(typeof result.latencyMs).toBe('number')
  })

  it('разбирает updatedRow из диапазона вида Запись 2026!A12:K12', async () => {
    mock.spreadsheets.values.append.mockResolvedValue({
      data: { updates: { updatedRange: 'Запись 2026!A12:K12' } },
      status: 200,
    })
    const result = await appendBooking(['04.06.2026', '10:00', '', '', '', '', '', '', '', '', ''])
    assert(result.ok)
    expect(result.updatedRow).toBe(12)
  })

  it('URI-кодирует Запись 2026 в аргументе range, передаваемом в API', async () => {
    mock.spreadsheets.values.append.mockResolvedValue({
      data: { updates: { updatedRange: 'Запись 2026!A2' } },
      status: 200,
    })
    await appendBooking(['04.06.2026', '10:00', '', '', '', '', '', '', '', '', ''])
    const call = mock.spreadsheets.values.append.mock
      .calls[0]?.[0] as sheets_v4.Params$Resource$Spreadsheets$Values$Append
    // Диапазон, передаваемый в googleapis, должен содержать имя листа как есть;
    // URL-кодирование googleapis выполняет сам.
    expect(call.range).toBe('Запись 2026!A1')
    expect(call.spreadsheetId).toBe('test-spreadsheet-id')
    expect(call.valueInputOption).toBe('USER_ENTERED')
    expect(call.insertDataOption).toBe('INSERT_ROWS')
  })

  it('при сбое API возвращает ok:false с errorCode', async () => {
    mock.spreadsheets.values.append.mockRejectedValue({
      code: 403,
      errors: [{ reason: 'forbidden' }],
      message: 'The caller does not have permission',
    })
    const result = await appendBooking(['04.06.2026', '10:00', '', '', '', '', '', '', '', '', ''])
    assert(!result.ok)
    expect(result.statusCode).toBe(403)
    expect(result.errorCode).toBe('forbidden')
  })
})
