import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: { TELEGRAM_BOT_TOKEN: 'test-bot-token' },
}))

vi.mock('../src/log.js', () => ({
  baseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

import { sendTelegramMessage, escapeHtml, _setFetchForTest } from '../src/telegram.js'

describe('escapeHtml', () => {
  it('escapes &, < and > only', () => {
    expect(escapeHtml('Tom & <b>Jerry</b>')).toBe('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;')
  })
})

describe('sendTelegramMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts to the bot sendMessage endpoint with the chat id and HTML text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('12345', '<b>hi</b>')
    expect(result).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/bottest-bot-token/sendMessage')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ chat_id: '12345', text: '<b>hi</b>', parse_mode: 'HTML' })
  })

  it('returns the Telegram description on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ description: 'chat not found' }),
    })
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('999', 'x')
    expect(result).toEqual({ ok: false, reason: 'chat not found' })
  })

  it('falls back to http_<status> when the error body is not JSON', async () => {
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

  it('returns ok:false with the error message when the request throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    _setFetchForTest(fetchMock as unknown as typeof fetch)

    const result = await sendTelegramMessage('999', 'x')
    expect(result).toEqual({ ok: false, reason: 'network down' })
  })
})
