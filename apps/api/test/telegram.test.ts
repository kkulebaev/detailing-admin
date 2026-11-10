import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: { TELEGRAM_BOT_TOKEN: 'test-bot-token' },
}))

vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

import { sendTelegramMessage, escapeHtml, _setFetchForTest } from '../src/telegram.js'

describe('escapeHtml', () => {
  it('экранирует только &, < и >', () => {
    expect(escapeHtml('Tom & <b>Jerry</b>')).toBe('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;')
  })
})

describe('sendTelegramMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('отправляет POST на эндпоинт sendMessage бота с chat id и HTML-текстом', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('12345', '<b>hi</b>')
    expect(result).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/bottest-bot-token/sendMessage')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ chat_id: '12345', text: '<b>hi</b>', parse_mode: 'HTML' })
  })

  it('возвращает description от Telegram при ответе не 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ description: 'chat not found' }),
    })
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('999', 'x')
    expect(result).toEqual({ ok: false, reason: 'chat not found' })
  })

  it('откатывается к http_<status>, если тело ошибки не JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('999', 'x')
    expect(result).toEqual({ ok: false, reason: 'http_502' })
  })

  it('возвращает ok:false с текстом ошибки, если запрос бросает исключение', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('999', 'x')
    expect(result).toEqual({ ok: false, reason: 'network down' })
  })
})
