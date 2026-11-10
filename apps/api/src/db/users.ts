import { and, eq, sql } from 'drizzle-orm'
import { toRole, type Account, type Role } from '@detailing-admin/shared'
import { getDb } from './client.js'
import { users, type User } from './schema.js'

export type UserMutationError = 'duplicate_login'

export class UserError extends Error {
  constructor(public readonly code: UserMutationError) {
    super(code)
    this.name = 'UserError'
  }
}

export async function findByLogin(login: string): Promise<User | null> {
  const db = getDb()
  const [row] = await db.select().from(users).where(eq(users.login, login)).limit(1)
  return row ?? null
}

export async function createUser(input: {
  login: string
  passwordHash: string
  role: Role
  firstName?: string
  lastName?: string
}): Promise<User> {
  const db = getDb()
  const [existing] = await db.select().from(users).where(eq(users.login, input.login)).limit(1)
  if (existing) throw new UserError('duplicate_login')
  const [row] = await db
    .insert(users)
    .values({
      login: input.login,
      passwordHash: input.passwordHash,
      role: input.role,
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
    })
    .returning()
  return row
}

/** Обновляет личные поля самого вызывающего (имя); возвращает свежую строку. */
export async function updateProfile(
  id: string,
  input: { firstName: string; lastName: string },
): Promise<User | null> {
  const db = getDb()
  const [row] = await db
    .update(users)
    .set({ firstName: input.firstName, lastName: input.lastName })
    .where(eq(users.id, id))
    .returning()
  return row ?? null
}

/**
 * Условная замена пароля. Условие `WHERE ... AND password_hash = <old>` превращает
 * проигравший гонку параллельный change-password в no-op (возвращает `false`),
 * а не молча перезаписывает победителя — вызывающий код превращает это в 409.
 */
export async function updatePasswordHash(
  id: string,
  newHash: string,
  oldHash: string,
): Promise<boolean> {
  const db = getDb()
  const updated = await db
    .update(users)
    .set({ passwordHash: newHash, passwordChangedAt: sql`now()` })
    .where(and(eq(users.id, id), eq(users.passwordHash, oldHash)))
    .returning({ id: users.id })
  return updated.length > 0
}

/** Сбрасывает пароль любого пользователя по логину (для CLI — без проверки старого хэша). */
export async function resetPasswordByLogin(login: string, newHash: string): Promise<boolean> {
  const db = getDb()
  const updated = await db
    .update(users)
    .set({ passwordHash: newHash, passwordChangedAt: sql`now()` })
    .where(eq(users.login, login))
    .returning({ id: users.id })
  return updated.length > 0
}

/** Меняет роль любого пользователя по логину (для CLI). */
export async function setRoleByLogin(login: string, role: Role): Promise<boolean> {
  const db = getDb()
  const updated = await db
    .update(users)
    .set({ role })
    .where(eq(users.login, login))
    .returning({ id: users.id })
  return updated.length > 0
}

/** Аккаунты для выбора привязки в форме мастера — хэш пароля никогда не выбирается. */
export async function listAccounts(): Promise<Account[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: users.id,
      login: users.login,
      role: users.role,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .orderBy(users.login)
  return rows.map((r) => ({ ...r, role: toRole(r.role) }))
}
