import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { telegramLinkTokens, users } from '../db/schema.js'

// Ссылка живет недолго: она открывает привязку чата к аккаунту любому, кто ее получил.
export const TELEGRAM_LINK_TTL_MINUTES = 10

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Новый одноразовый токен; прежние токены аккаунта гасятся, чтобы рабочей была только
 * последняя выданная ссылка. Срок считает база, тем же now(), что и при гашении. */
export async function createLinkToken(userId: string): Promise<string> {
  // 24 байта → 32 символа base64url: укладывается в лимит start-параметра (64 символа
  // из A-Za-z0-9_-).
  const token = randomBytes(24).toString('base64url')
  await getDb().transaction(async (tx) => {
    await tx.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, userId))
    await tx.insert(telegramLinkTokens).values({
      tokenHash: hashLinkToken(token),
      userId,
      expiresAt: sql`now() + make_interval(mins => ${TELEGRAM_LINK_TTL_MINUTES})`,
    })
  })
  return token
}

export type LinkResult = 'linked' | 'relinked' | 'already_linked' | 'expired'

/** /start <token>. Токен гасится одним условным UPDATE … RETURNING: из двух одновременных
 * доставок одного апдейта чат привязывает только одна. Чат, привязанный к другому
 * аккаунту, переходит к новому: один чат — один аккаунт (UNIQUE). */
export async function linkChatByToken(token: string, chatId: string): Promise<LinkResult> {
  const tokenHash = hashLinkToken(token)
  return getDb().transaction(async (tx) => {
    const [consumed] = await tx
      .update(telegramLinkTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(telegramLinkTokens.tokenHash, tokenHash),
          isNull(telegramLinkTokens.usedAt),
          gt(telegramLinkTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: telegramLinkTokens.userId })
    if (!consumed) {
      // Повторная доставка того же апдейта (рестарт до подтверждения offset) — успех,
      // но только если чат привязан к аккаунту этого токена. Чужой чат с тем же токеном
      // или погашенная ссылка, чей чат потом перевесили, — «ссылка устарела».
      const [same] = await tx
        .select({ id: users.id })
        .from(telegramLinkTokens)
        .innerJoin(users, eq(users.id, telegramLinkTokens.userId))
        .where(
          and(
            eq(telegramLinkTokens.tokenHash, tokenHash),
            isNotNull(telegramLinkTokens.usedAt),
            eq(users.telegramChatId, chatId),
          ),
        )
        .limit(1)
      return same ? 'already_linked' : 'expired'
    }
    // Сначала снять чат со старого аккаунта, иначе UNIQUE не даст записать его новому.
    const moved = await tx
      .update(users)
      .set({ telegramChatId: null })
      .where(and(eq(users.telegramChatId, chatId), ne(users.id, consumed.userId)))
      .returning({ id: users.id })
    await tx.update(users).set({ telegramChatId: chatId }).where(eq(users.id, consumed.userId))
    return moved.length > 0 ? 'relinked' : 'linked'
  })
}

export async function isTelegramConnected(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNotNull(users.telegramChatId)))
    .limit(1)
  return rows.length > 0
}

export async function telegramChatIdOf(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
  return row?.chatId ?? null
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await getDb().update(users).set({ telegramChatId: null }).where(eq(users.id, userId))
}

/** Бот заблокирован: отвязываем, но только тот же чат — пока шла отправка, аккаунт мог
 * уже привязать новый. */
export async function unlinkBlockedChat(userId: string, chatId: string): Promise<void> {
  await getDb()
    .update(users)
    .set({ telegramChatId: null })
    .where(and(eq(users.id, userId), eq(users.telegramChatId, chatId)))
}

export async function deleteExpiredLinkTokens(): Promise<number> {
  const deleted = await getDb()
    .delete(telegramLinkTokens)
    .where(lt(telegramLinkTokens.expiresAt, sql`now()`))
    .returning({ tokenHash: telegramLinkTokens.tokenHash })
  return deleted.length
}
