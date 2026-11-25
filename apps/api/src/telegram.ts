import { env } from './env.js'
import { baseLogger } from './log.js'

export interface TelegramSendResult {
  ok: boolean
  // HTTP-статус ответа Telegram; нет, если ответа не было (сеть, таймаут). Новая
  // доставка по нему отличает отказ по чату (попытка состоялась) от недоступного API.
  status?: number
  // parameters.retry_after из ответа 429: сколько секунд Telegram просит не слать.
  retryAfter?: number
  // Краткая причина сбоя без PII (`description` от Telegram, HTTP-статус или
  // 'timeout'). Никогда не содержит текст сообщения.
  reason?: string
}

// Подменяемый транспорт, чтобы тесты не ходили в сеть. По умолчанию — глобальный
// fetch (Node 22+); устроен так же, как шов `_setClientForTest` в sheets.ts.
type Fetcher = typeof fetch
let _fetch: Fetcher = fetch

/** Только для тестов — позволяет застабить HTTP-транспорт. */
export function _setFetchForTest(fn: Fetcher): void {
  _fetch = fn
}

const TIMEOUT_MS = 5000

// HTML parse_mode требует экранировать эти три символа в пользовательском тексте;
// без экранирования ломается отображение, а имя может внедрить разметку.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface TelegramApiResponse {
  status: number
  body: unknown
}

/** Произвольный метод Bot API через тот же шов, что и sendMessage. Бросает, если ответа
 * не было (сеть, abort); не-2xx возвращает как есть: что считать ошибкой, решает вызывающий. */
export async function callTelegramApi(
  method: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<TelegramApiResponse> {
  const res = await _fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Не JSON (прокси, HTML-страница ошибки): хватит статуса.
  }
  return { status: res.status, body }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await _fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      let reason = `http_${res.status}`
      let retryAfter: number | undefined
      try {
        const body: unknown = await res.json()
        if (
          body !== null &&
          typeof body === 'object' &&
          'description' in body &&
          typeof body.description === 'string'
        ) {
          reason = body.description
        }
        if (
          body !== null &&
          typeof body === 'object' &&
          'parameters' in body &&
          typeof body.parameters === 'object' &&
          body.parameters !== null &&
          'retry_after' in body.parameters &&
          typeof body.parameters.retry_after === 'number'
        ) {
          retryAfter = body.parameters.retry_after
        }
      } catch {
        // Тело ошибки не JSON — оставляем запасной вариант http_<status>.
      }
      baseLogger.warn(
        { event: 'telegram.send_failed', status: res.status, reason },
        'Telegram sendMessage returned non-2xx',
      )
      return retryAfter === undefined
        ? { ok: false, status: res.status, reason }
        : { ok: false, status: res.status, reason, retryAfter }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    const reason =
      err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err)
    baseLogger.warn({ event: 'telegram.send_error', reason }, 'Telegram sendMessage threw')
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}
