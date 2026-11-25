import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/env.js', () => ({ env: { TELEGRAM_BOT_TOKEN: 'test-bot-token' } }))
vi.mock('../src/log.js', () => ({
  baseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))
vi.mock('../src/notifications/telegram-link.js', () => ({ linkChatByToken: vi.fn() }))

import { baseLogger } from '../src/log.js'
import { linkChatByToken } from '../src/notifications/telegram-link.js'
import {
  _setBotUsernameForTest,
  getBotUsername,
  handleTelegramUpdate,
  startTelegramPoller,
  type TelegramPoller,
  type TelegramUpdate,
} from '../src/notifications/telegram-poller.js'
import { _setFetchForTest } from '../src/telegram.js'

interface ApiCall {
  method: string
  body: Record<string, unknown>
  signal: AbortSignal
}

type Answer = { status?: number; body?: unknown } | Error | 'hang'

// Фейковый Bot API: ответы на каждый метод по очереди; 'hang' висит до abort, как long
// poll без апдейтов. Когда очередь кончилась, getUpdates тоже висит.
function fakeBot(answers: Partial<Record<string, Answer[]>>) {
  const calls: ApiCall[] = []
  _setFetchForTest(async (url, init) => {
    const method = String(url).split('/').pop()!
    const signal = init!.signal as AbortSignal
    calls.push({ method, body: JSON.parse(String(init!.body)), signal })
    const answer = answers[method]?.shift() ?? (method === 'sendMessage' ? {} : 'hang')
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    if (answer instanceof Error) throw answer
    return Response.json(answer.body ?? { ok: true, result: true }, {
      status: answer.status ?? 200,
    })
  })
  return calls
}

const me = { body: { ok: true, result: { id: 1, is_bot: true, username: 'dazzle_bot' } } }
const updates = (...list: TelegramUpdate[]) => ({ body: { ok: true, result: list } })
const start = (
  id: number,
  text: string,
  chat: { id: number; type: string } = { id: 777, type: 'private' },
) => ({
  update_id: id,
  message: { text, chat },
})

const replies = (calls: ApiCall[]) =>
  calls.filter((c) => c.method === 'sendMessage').map((c) => [c.body.chat_id, c.body.text])
const polls = (calls: ApiCall[]) => calls.filter((c) => c.method === 'getUpdates')

let poller: TelegramPoller | null = null

beforeEach(() => {
  _setBotUsernameForTest(null)
  vi.mocked(linkChatByToken).mockReset()
  for (const fn of Object.values(baseLogger)) {
    if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear()
  }
})

afterEach(async () => {
  await poller?.stop()
  poller = null
  vi.useRealTimers()
})

describe('handleTelegramUpdate', () => {
  it.each([
    ['linked', 'Уведомления подключены'],
    [
      'relinked',
      'Уведомления подключены. Этот чат больше не получает уведомления прежнего аккаунта.',
    ],
    ['already_linked', 'Уже подключено'],
    ['expired', 'Ссылка устарела, создайте новую в профиле'],
  ] as const)('/start <token> → %s', async (result, reply) => {
    vi.mocked(linkChatByToken).mockResolvedValue(result)
    const calls = fakeBot({})
    await handleTelegramUpdate(start(1, '/start tok_123'))
    expect(vi.mocked(linkChatByToken)).toHaveBeenCalledWith('tok_123', '777')
    expect(replies(calls)).toEqual([['777', reply]])
  })

  it('/start@bot <token> тоже привязывает', async () => {
    vi.mocked(linkChatByToken).mockResolvedValue('linked')
    fakeBot({})
    await handleTelegramUpdate(start(1, '/start@dazzle_bot tok'))
    expect(vi.mocked(linkChatByToken)).toHaveBeenCalledWith('tok', '777')
  })

  it.each(['/start', 'привет', '/help', ''])('«%s» → подсказка, без привязки', async (text) => {
    const calls = fakeBot({})
    await handleTelegramUpdate(start(1, text))
    expect(vi.mocked(linkChatByToken)).not.toHaveBeenCalled()
    expect(replies(calls)).toEqual([['777', 'Подключите уведомления в профиле приложения']])
  })

  it('группы игнорируются', async () => {
    const calls = fakeBot({})
    await handleTelegramUpdate(start(1, '/start tok', { id: -100, type: 'group' }))
    expect(vi.mocked(linkChatByToken)).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('в логах нет ни текста, ни chat id, ни токена', async () => {
    vi.mocked(linkChatByToken).mockResolvedValue('linked')
    fakeBot({})
    await handleTelegramUpdate(start(1, '/start secret-token'))
    const logged = JSON.stringify(
      Object.values(baseLogger).flatMap((fn) => ('mock' in fn ? fn.mock.calls : [])),
    )
    expect(logged).toContain('telegram.link')
    expect(logged).not.toContain('777')
    expect(logged).not.toContain('secret-token')
    expect(logged).not.toContain('подключены')
  })
})

describe('startTelegramPoller', () => {
  it('getMe дает username; сбой getMe — botAvailable=false и повтор с backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const calls = fakeBot({ getMe: [new Error('network down'), { status: 502 }, me] })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(getBotUsername()).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.filter((c) => c.method === 'getMe')).toHaveLength(2)
    expect(getBotUsername()).toBeNull()
    // Backoff растет: следующая попытка не раньше чем через 2 с.
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls.filter((c) => c.method === 'getMe')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    await vi.waitFor(() => expect(getBotUsername()).toBe('dazzle_bot'))
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(1))
  })

  it('long polling с offset: подтверждает обработанное следующим getUpdates', async () => {
    vi.mocked(linkChatByToken).mockResolvedValue('linked')
    const calls = fakeBot({
      getMe: [me],
      // Последний ответ — подтверждение offset при остановке в afterEach.
      getUpdates: [updates(start(10, '/start a'), start(11, 'привет')), 'hang', updates()],
    })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(2))
    expect(polls(calls)[0]!.body).toEqual({
      offset: 0,
      timeout: 25,
      allowed_updates: ['message'],
    })
    expect(polls(calls)[1]!.body.offset).toBe(12)
    expect(replies(calls)).toEqual([
      ['777', 'Уведомления подключены'],
      ['777', 'Подключите уведомления в профиле приложения'],
    ])
  })

  it('сбой обработки апдейта не останавливает цикл и не зацикливает апдейт', async () => {
    vi.mocked(linkChatByToken).mockRejectedValue(new Error('db down'))
    const calls = fakeBot({
      getMe: [me],
      getUpdates: [updates(start(5, '/start a')), 'hang', updates()],
    })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(2))
    expect(polls(calls)[1]!.body.offset).toBe(6)
    expect(vi.mocked(baseLogger.warn)).toHaveBeenCalledWith(
      { event: 'telegram.update_failed' },
      expect.any(String),
    )
  })

  it('409 — штатно: debug-лог и повтор после паузы', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const calls = fakeBot({
      getMe: [me],
      getUpdates: [{ status: 409, body: { ok: false, description: 'Conflict' } }],
    })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(1))
    await vi.waitFor(() =>
      expect(vi.mocked(baseLogger.debug)).toHaveBeenCalledWith(
        { event: 'telegram.poll.conflict' },
        expect.any(String),
      ),
    )
    expect(vi.mocked(baseLogger.warn)).not.toHaveBeenCalled()
    expect(polls(calls)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(2))
    expect(polls(calls)[1]!.body.offset).toBe(0)
  })

  it('409 из-за webhook — warn один раз, а не на каждую паузу', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const webhook = {
      status: 409,
      body: {
        ok: false,
        description: "Conflict: can't use getUpdates method while webhook is active",
      },
    }
    const calls = fakeBot({ getMe: [me], getUpdates: [webhook, webhook, webhook] })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(3))
    const warns = vi
      .mocked(baseLogger.warn)
      .mock.calls.filter(([o]) => JSON.stringify(o).includes('telegram.poll.webhook_active'))
    expect(warns).toHaveLength(1)
    expect(vi.mocked(baseLogger.debug)).not.toHaveBeenCalled()
  })

  it('stop обрывает текущий getUpdates и выходит из цикла', async () => {
    const calls = fakeBot({ getMe: [me] })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(1))
    const inFlight = polls(calls)[0]!.signal
    await poller.stop()
    poller = null
    expect(inFlight.aborted).toBe(true)
    // Нечего подтверждать — лишнего запроса нет.
    expect(calls).toHaveLength(2)
  })

  it('stop во время backoff не ждет паузу', async () => {
    const calls = fakeBot({ getMe: [new Error('network down')] })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const started = Date.now()
    await poller.stop()
    poller = null
    expect(Date.now() - started).toBeLessThan(500)
    expect(calls).toHaveLength(1)
  })

  it('при остановке подтверждает обработанный, но еще не подтвержденный offset', async () => {
    vi.mocked(linkChatByToken).mockResolvedValue('linked')
    const calls = fakeBot({
      getMe: [me],
      getUpdates: [updates(start(7, '/start a')), 'hang', updates()],
    })
    poller = startTelegramPoller()
    await vi.waitFor(() => expect(polls(calls)).toHaveLength(2))
    await poller.stop()
    poller = null
    const last = polls(calls).at(-1)!
    expect(polls(calls)).toHaveLength(3)
    expect(last.body).toMatchObject({ offset: 8, timeout: 0 })
  })
})
