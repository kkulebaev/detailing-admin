import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from './client.js'
import { masters, users, type Master } from './schema.js'

export type MasterMutationError =
  | 'duplicate_name'
  | 'archived_name'
  | 'duplicate_user'
  | 'unknown_user'
  | 'not_found'
  | 'invalid_order'

export class MasterError extends Error {
  constructor(public readonly code: MasterMutationError) {
    super(code)
    this.name = 'MasterError'
  }
}

export interface MasterInput {
  name: string
  canBeResponsible: boolean
  paidSalary: boolean
  telegramId: string | null
  userId: string | null
}

export async function listMasters(): Promise<Master[]> {
  const db = getDb()
  return db
    .select()
    .from(masters)
    .where(eq(masters.archived, false))
    .orderBy(masters.position, masters.id)
}

// Архивный мастер сохраняет UNIQUE-имя, но в приложении не виден, поэтому у такого
// конфликта свой код: «уже существует» указывало бы на строку, которую никто не видит.
async function assertNameFree(name: string, masterId?: number) {
  const db = getDb()
  const [duplicate] = await db
    .select({ id: masters.id, archived: masters.archived })
    .from(masters)
    .where(eq(masters.name, name))
    .limit(1)
  if (!duplicate || duplicate.id === masterId) return
  throw new MasterError(duplicate.archived ? 'archived_name' : 'duplicate_name')
}

// Имена уникальны (см. ограничение unique на `name`), поэтому находится не больше
// одной строки. Используется, чтобы найти chat id мастера в Telegram по свободному
// имени, сохранённому в записи.
export async function findMasterByName(name: string): Promise<Master | undefined> {
  const db = getDb()
  const [row] = await db.select().from(masters).where(eq(masters.name, name)).limit(1)
  return row
}

// Пакетный best-effort резолвер name→id для id-связи запись↔мастер. Обрезает и
// дедуплицирует запрошенные имена, затем сопоставляет их с UNIQUE `masters.name`
// (та же семантика точного совпадения, что в findMasterByName). Ненайденного имени
// просто нет в map — так задумано, это не ошибка. Пустой ввод сразу возвращает результат.
export async function resolveMasterIds(names: string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (wanted.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({ id: masters.id, name: masters.name })
    .from(masters)
    .where(inArray(masters.name, wanted))
  return new Map(rows.map((r) => [r.name, r.id]))
}

export async function findMasterByUserId(userId: string): Promise<Master | undefined> {
  const db = getDb()
  const [row] = await db.select().from(masters).where(eq(masters.userId, userId)).limit(1)
  return row
}

// Проверяется заранее, чтобы маршрут ответил ошибкой поля / 409, а не невнятным 500,
// который иначе выдали бы FK или ограничение UNIQUE.
async function assertUserLinkable(userId: string | null | undefined, masterId?: number) {
  if (userId == null) return
  const db = getDb()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new MasterError('unknown_user')
  const linked = await findMasterByUserId(userId)
  if (linked && linked.id !== masterId) throw new MasterError('duplicate_user')
}

// Следующая позиция в конце упорядоченного списка. При пустой таблице -1 + 1 = 0.
async function nextPosition(): Promise<number> {
  const db = getDb()
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${masters.position}), -1)` })
    .from(masters)
  return max + 1
}

export async function createMaster(input: MasterInput): Promise<Master> {
  const db = getDb()
  await assertNameFree(input.name)
  await assertUserLinkable(input.userId)

  const position = await nextPosition()
  const [row] = await db
    .insert(masters)
    .values({
      name: input.name,
      canBeResponsible: input.canBeResponsible,
      paidSalary: input.paidSalary,
      telegramId: input.telegramId,
      userId: input.userId,
      position,
    })
    .returning()
  return row
}

export interface MasterPatch {
  name?: string
  canBeResponsible?: boolean
  paidSalary?: boolean
  telegramId?: string | null
  userId?: string | null
}

export async function updateMaster(id: number, patch: MasterPatch): Promise<Master> {
  const db = getDb()

  if (patch.name !== undefined) await assertNameFree(patch.name, id)
  await assertUserLinkable(patch.userId, id)

  const [row] = await db
    .update(masters)
    .set(patch)
    .where(and(eq(masters.id, id), eq(masters.archived, false)))
    .returning()
  if (!row) throw new MasterError('not_found')
  return row
}

// Мягкое удаление: записи, часы и выплаты должны и дальше указывать на эту строку.
// Аккаунт отвязывается, потому что иначе UNIQUE-связь не дала бы привязать его к другому
// мастеру из-за строки, которую админ больше не видит, и потому что удалённый мастер
// не должен продолжать вносить часы в «Мои часы».
export async function deleteMaster(id: number): Promise<void> {
  const db = getDb()
  const result = await db
    .update(masters)
    .set({ archived: true, userId: null })
    .where(and(eq(masters.id, id), eq(masters.archived, false)))
    .returning({ id: masters.id })
  if (result.length === 0) throw new MasterError('not_found')
}

// Назначает плотные позиции 0..n-1 в заданном порядке. Присланный набор id должен
// совпадать с полным набором неархивных строк — частичный или чужой набор
// отклоняется без изменения таблицы, чтобы позиции не рассинхронизировались молча.
export async function reorderMasters(ids: number[]): Promise<Master[]> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: masters.id })
      .from(masters)
      .where(eq(masters.archived, false))
    const existingIds = new Set(existing.map((r) => r.id))
    const postedIds = new Set(ids)
    const sameSize = postedIds.size === ids.length && existingIds.size === postedIds.size
    const sameMembers = sameSize && ids.every((id) => existingIds.has(id))
    if (!sameMembers) throw new MasterError('invalid_order')

    for (let i = 0; i < ids.length; i++) {
      await tx.update(masters).set({ position: i }).where(eq(masters.id, ids[i]))
    }
    return tx
      .select()
      .from(masters)
      .where(eq(masters.archived, false))
      .orderBy(masters.position, masters.id)
  })
}
