import { env } from './env.js'
import { baseLogger } from './log.js'

export interface TelegramSendResult {
  ok: boolean
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
      } catch {
        // Тело ошибки не JSON — оставляем запасной вариант http_<status>.
      }
      baseLogger.warn(
        { event: 'telegram.send_failed', status: res.status, reason },
        'Telegram sendMessage returned non-2xx',
      )
      return { ok: false, reason }
    }
    return { ok: true }
  } catch (err) {
    const reason =
      err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err)
    baseLogger.warn({ event: 'telegram.send_error', reason }, 'Telegram sendMessage threw')
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}
