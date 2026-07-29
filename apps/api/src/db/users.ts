import { and, eq, sql } from 'drizzle-orm'
import type { Role } from '@detailing-admin/shared'
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
}): Promise<User> {
  const db = getDb()
  const [existing] = await db.select().from(users).where(eq(users.login, input.login)).limit(1)
  if (existing) throw new UserError('duplicate_login')
  const [row] = await db
    .insert(users)
    .values({ login: input.login, passwordHash: input.passwordHash, role: input.role })
    .returning()
  return row
}

/**
 * Conditional password swap. The `WHERE ... AND password_hash = <old>` guard
 * makes a concurrent change-password lose the race a no-op (returns `false`)
 * instead of silently overwriting the winner — the caller maps that to 409.
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

/** Reset any user's password by login (CLI use — no old-hash guard). */
export async function resetPasswordByLogin(login: string, newHash: string): Promise<boolean> {
  const db = getDb()
  const updated = await db
    .update(users)
    .set({ passwordHash: newHash, passwordChangedAt: sql`now()` })
    .where(eq(users.login, login))
    .returning({ id: users.id })
  return updated.length > 0
}
