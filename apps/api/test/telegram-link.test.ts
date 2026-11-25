import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }))

import { createHash } from 'node:crypto'
import { getTableName, type Table } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getDb } from '../src/db/client.js'
import {
  createLinkToken,
  deleteExpiredLinkTokens,
  linkChatByToken,
} from '../src/notifications/telegram-link.js'

const render = (w: unknown) => new PgDialect().sqlToQuery(w as never)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

interface Call {
  op: string
  table: string
  where?: unknown
  set?: Record<string, unknown>
  values?: Record<string, unknown>
}

// Thenable-фейк: UPDATE токена отдает `consumed`, снятие чата с другого аккаунта —
// `moved`, SELECT погашенного токена с этим чатом — `linkedChat`; DELETE — `consumed`.
function makeDb(
  opts: { consumed?: { userId: string }[]; linkedChat?: boolean; moved?: boolean } = {},
) {
  const calls: Call[] = []
  const chain = (op: string, table: Table | undefined, result: () => unknown) => {
    const call: Call = { op, table: table ? getTableName(table) : '' }
    calls.push(call)
    const c: Record<string, unknown> = {}
    for (const m of ['limit', 'returning', 'innerJoin']) c[m] = () => c
    c.from = (t: Table) => {
      call.table = getTableName(t)
      return c
    }
    c.where = (w: unknown) => {
      call.where = w
      return c
    }
    c.set = (v: Record<string, unknown>) => {
      call.set = v
      return c
    }
    c.values = (v: Record<string, unknown>) => {
      call.values = v
      return c
    }
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
    return c
  }
  const ops = {
    select: () => chain('select', undefined, () => (opts.linkedChat ? [{ id: 'u-old' }] : [])),
    delete: (t: Table) => chain('delete', t, () => opts.consumed ?? []),
    update: (t: Table) =>
      chain('update', t, () => {
        if (getTableName(t) === 'telegram_link_tokens') return opts.consumed ?? []
        const call = calls.at(-1)!
        return call.set?.telegramChatId === null && opts.moved ? [{ id: 'u-old' }] : []
      }),
    insert: (t: Table) => chain('insert', t, () => []),
  }
  vi.mocked(getDb).mockReturnValue({
    ...ops,
    transaction: async (fn: (tx: typeof ops) => unknown) => fn(ops),
  } as never)
  return calls
}

beforeEach(() => vi.mocked(getDb).mockReset())

describe('createLinkToken', () => {
  it('в базу идет только sha256, прежние токены аккаунта гасятся, срок 10 минут', async () => {
    const calls = makeDb()
    const token = await createLinkToken('u-emp')
    // Влезает в start-параметр Telegram: до 64 символов из A-Za-z0-9_-.
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)

    expect(calls.map((c) => `${c.op} ${c.table}`)).toEqual([
      'delete telegram_link_tokens',
      'insert telegram_link_tokens',
    ])
    expect(render(calls[0]!.where).params).toEqual(['u-emp'])
    const values = calls[1]!.values!
    expect(values.tokenHash).toBe(sha(token))
    expect(JSON.stringify(values)).not.toContain(token)
    expect(values.userId).toBe('u-emp')
    const expires = render(values.expiresAt)
    expect(expires.sql).toBe('now() + make_interval(mins => $1)')
    expect(expires.params).toEqual([10])
  })

  it('каждая ссылка — новый токен', async () => {
    makeDb()
    expect(await createLinkToken('u-emp')).not.toBe(await createLinkToken('u-emp'))
  })
})

describe('linkChatByToken', () => {
  const updatesOf = (calls: Call[], table: string) =>
    calls.filter((c) => c.op === 'update' && c.table === table)

  it('гасит токен условным UPDATE: не погашен и не просрочен (критерий 11)', async () => {
    const calls = makeDb({ consumed: [{ userId: 'u-new' }] })
    expect(await linkChatByToken('tok', '777')).toBe('linked')
    const [consume] = updatesOf(calls, 'telegram_link_tokens')
    expect(render(consume!.set!.usedAt).sql).toBe('now()')
    const where = render(consume!.where)
    expect(where.sql).toBe(
      '("telegram_link_tokens"."token_hash" = $1 and "telegram_link_tokens"."used_at" is null and "telegram_link_tokens"."expires_at" > now())',
    )
    expect(where.params).toEqual([sha('tok')])
    // Токен не удаляется: по нему узнается повторная доставка.
    expect(calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('чат другого аккаунта перевешивается на новый, у старого null (критерий 6h)', async () => {
    const calls = makeDb({ consumed: [{ userId: 'u-new' }], moved: true })
    expect(await linkChatByToken('tok', '777')).toBe('relinked')
    const updates = updatesOf(calls, 'users')
    expect(updates).toHaveLength(2)
    // Сначала снять со старого, иначе UNIQUE не даст записать новому.
    expect(updates[0]!.set).toEqual({ telegramChatId: null })
    const clear = render(updates[0]!.where)
    expect(clear.sql).toBe('("users"."telegram_chat_id" = $1 and "users"."id" <> $2)')
    expect(clear.params).toEqual(['777', 'u-new'])
    expect(updates[1]!.set).toEqual({ telegramChatId: '777' })
    expect(render(updates[1]!.where).params).toEqual(['u-new'])
  })

  it('свободный чат — просто «подключено»', async () => {
    makeDb({ consumed: [{ userId: 'u-new' }], moved: false })
    expect(await linkChatByToken('tok', '777')).toBe('linked')
  })

  it('повтор погашенного токена: «уже подключено», только если чат у аккаунта токена', async () => {
    const calls = makeDb({ consumed: [], linkedChat: true })
    expect(await linkChatByToken('tok', '777')).toBe('already_linked')
    expect(updatesOf(calls, 'users')).toHaveLength(0)
    const check = render(calls.find((c) => c.op === 'select')!.where)
    expect(check.sql).toBe(
      '("telegram_link_tokens"."token_hash" = $1 and "telegram_link_tokens"."used_at" is not null and "users"."telegram_chat_id" = $2)',
    )
    expect(check.params).toEqual([sha('tok'), '777'])
  })

  it('чужой чат с погашенным токеном, просроченный или неизвестный токен → «устарела» (критерий 11)', async () => {
    const calls = makeDb({ consumed: [], linkedChat: false })
    expect(await linkChatByToken('tok', '888')).toBe('expired')
    expect(updatesOf(calls, 'users')).toHaveLength(0)
  })
})

describe('deleteExpiredLinkTokens', () => {
  it('удаляет только просроченные', async () => {
    const calls = makeDb({ consumed: [{ userId: 'a' }, { userId: 'b' }] })
    expect(await deleteExpiredLinkTokens()).toBe(2)
    expect(render(calls[0]!.where).sql).toBe('"telegram_link_tokens"."expires_at" < now()')
  })
})
