import { baseLogger } from '../log.js'
import { callTelegramApi, sendTelegramMessage } from '../telegram.js'
import { linkChatByToken } from './telegram-link.js'

// Апдейты бота нужны только для привязки чата по /start <token>. Long polling, а не
// webhook: у dev и prod разные боты, и dev не нужен публичный адрес.

const POLL_TIMEOUT_SECONDS = 25
// Запас поверх серверного long poll, чтобы зависшее соединение не держало цикл вечно.
const REQUEST_TIMEOUT_MS = (POLL_TIMEOUT_SECONDS + 10) * 1000
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 60_000
// Последнее подтверждение offset при остановке не должно задерживать SIGTERM.
const FINAL_CONFIRM_TIMEOUT_MS = 2000

export const TELEGRAM_REPLIES = {
  linked: 'Уведомления подключены',
  relinked: 'Уведомления подключены. Этот чат больше не получает уведомления прежнего аккаунта.',
  already_linked: 'Уже подключено',
  expired: 'Ссылка устарела, создайте новую в профиле',
  hint: 'Подключите уведомления в профиле приложения',
} as const

let botUsername: string | null = null

/** Username бота для deep link; null — бот не принимает /start (polling выключен или
 * getMe еще не прошел). */
export function getBotUsername(): string | null {
  return botUsername
}

/** Только для тестов и e2e: там poller не запускается, а ссылка нужна. */
export function _setBotUsernameForTest(name: string | null): void {
  botUsername = name
}

export interface TelegramUpdate {
  update_id: number
  message?: {
    text?: string
    chat?: { id?: number | string; type?: string }
  }
}

const START_RE = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/

/** Один апдейт. Никогда не бросает наружу ошибку отправки ответа; в логах нет ни текста
 * сообщения, ни chat id. */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const chat = update.message?.chat
  // Группы и каналы игнорируем: привязывается только личный чат с ботом.
  if (!chat || chat.id === undefined || chat.type !== 'private') return
  const chatId = String(chat.id)
  const match = START_RE.exec(update.message?.text ?? '')
  const token = match?.[1]
  let reply: string = TELEGRAM_REPLIES.hint
  if (token) {
    const result = await linkChatByToken(token, chatId)
    reply = TELEGRAM_REPLIES[result]
    baseLogger.info({ event: 'telegram.link', result }, 'Telegram /start processed')
  }
  await sendTelegramMessage(chatId, reply)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

function isOk(body: unknown): body is { ok: true; result: unknown } {
  return typeof body === 'object' && body !== null && 'ok' in body && body.ok === true
}

function isUpdate(u: unknown): u is TelegramUpdate {
  return typeof u === 'object' && u !== null && 'update_id' in u && typeof u.update_id === 'number'
}

function describes(body: unknown, word: string): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'description' in body &&
    typeof body.description === 'string' &&
    body.description.toLowerCase().includes(word)
  )
}

function usernameOf(body: unknown): string | null {
  if (!isOk(body)) return null
  const r = body.result
  if (typeof r === 'object' && r !== null && 'username' in r && typeof r.username === 'string') {
    return r.username
  }
  return null
}

export interface TelegramPoller {
  /** Обрывает текущий getUpdates и ждет выхода из цикла. */
  stop(): Promise<void>
}

/** Цикл никогда не бросает и не роняет процесс: любой сбой — пауза с backoff. */
export function startTelegramPoller(): TelegramPoller {
  const controller = new AbortController()
  const { signal } = controller
  let backoff = BACKOFF_MIN_MS
  // offset — следующий нужный апдейт; confirmed — offset, уже отправленный в getUpdates.
  // Апдейт подтвержден, только когда Telegram получил offset больше его id.
  let offset = 0
  let confirmed = 0
  let webhookWarned = false

  const pause = async () => {
    await sleep(backoff, signal)
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
  }

  async function identify(): Promise<boolean> {
    while (!signal.aborted) {
      try {
        const res = await callTelegramApi(
          'getMe',
          {},
          AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        )
        const name = usernameOf(res.body)
        if (name) {
          botUsername = name
          backoff = BACKOFF_MIN_MS
          return true
        }
        baseLogger.warn(
          { event: 'telegram.get_me_failed', status: res.status },
          'Telegram getMe failed',
        )
      } catch {
        if (signal.aborted) break
        baseLogger.warn({ event: 'telegram.get_me_failed' }, 'Telegram getMe failed')
      }
      await pause()
    }
    return false
  }

  async function poll(): Promise<void> {
    while (!signal.aborted) {
      let res
      const sent = offset
      try {
        res = await callTelegramApi(
          'getUpdates',
          { offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ['message'] },
          AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        )
      } catch {
        if (signal.aborted) break
        baseLogger.warn({ event: 'telegram.poll.error' }, 'Telegram getUpdates failed')
        await pause()
        continue
      }
      if (res.status === 409) {
        if (describes(res.body, 'webhook')) {
          // На боте стоит webhook: polling не заработает, пока его не снимут. Это ошибка
          // настройки, но повторять warn каждую паузу незачем.
          if (!webhookWarned) {
            webhookWarned = true
            baseLogger.warn(
              { event: 'telegram.poll.webhook_active' },
              'Bot has a webhook set, getUpdates is refused',
            )
          }
        } else {
          // На каждом деплое Railway старый и новый контейнер какое-то время живут вместе,
          // и Telegram отдает getUpdates только одному: это штатно, не warn.
          baseLogger.debug({ event: 'telegram.poll.conflict' }, 'Another getUpdates is active')
        }
        await pause()
        continue
      }
      if (!isOk(res.body) || !Array.isArray(res.body.result)) {
        baseLogger.warn(
          { event: 'telegram.poll.error', status: res.status },
          'Telegram getUpdates failed',
        )
        await pause()
        continue
      }
      confirmed = sent
      backoff = BACKOFF_MIN_MS
      for (const update of res.body.result.filter(isUpdate)) {
        // Сдвигаем offset и при сбое обработки: апдейт, который роняет обработчик, иначе
        // приходил бы бесконечно.
        offset = Math.max(offset, update.update_id + 1)
        try {
          await handleTelegramUpdate(update)
        } catch {
          baseLogger.warn({ event: 'telegram.update_failed' }, 'Telegram update handling failed')
        }
      }
    }
  }

  // При остановке подтверждаем уже обработанное, иначе новый контейнер получит те же
  // апдейты и ответит пользователю второй раз.
  async function confirmProcessed(): Promise<void> {
    if (offset <= confirmed) return
    try {
      await callTelegramApi(
        'getUpdates',
        { offset, timeout: 0, limit: 1, allowed_updates: ['message'] },
        AbortSignal.timeout(FINAL_CONFIRM_TIMEOUT_MS),
      )
    } catch {
      baseLogger.warn({ event: 'telegram.poll.confirm_failed' }, 'Final offset confirm failed')
    }
  }

  const loop = (async () => {
    try {
      if (await identify()) await poll()
      await confirmProcessed()
    } catch {
      baseLogger.error({ event: 'telegram.poll.crashed' }, 'Telegram poller stopped unexpectedly')
    }
  })()

  return {
    async stop() {
      controller.abort()
      await loop
    },
  }
}
