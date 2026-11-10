// Создает учетную запись для входа. Использование:
//   pnpm --filter @detailing-admin/api user:create --login <login> --role <admin|booker|employee>
//     [--first-name <name>] [--last-name <surname>]
// Флаги имени необязательны (пользователь может заполнить их позже на странице профиля).
// Запрашивает пароль (скрытый ввод). Прод: `railway run pnpm --filter
// @detailing-admin/api user:create --login <admin> --role admin`.
import { ROLES } from '@detailing-admin/shared'
import { getArg, readHidden, loadLocalEnv, fail } from './user-cli.js'

loadLocalEnv()

const login = getArg('login')
const role = getArg('role')
const firstName = getArg('first-name') ?? ''
const lastName = getArg('last-name') ?? ''

if (!login) fail('Missing --login')
if (!role || !ROLES.includes(role as (typeof ROLES)[number])) {
  fail(`Missing or invalid --role (expected one of: ${ROLES.join(', ')})`)
}

const password = await readHidden('Password: ')
if (password.length < 8) fail('Password must be at least 8 characters')
const confirm = await readHidden('Confirm password: ')
if (password !== confirm) fail('Passwords do not match')

// Модули, зависящие от env, импортируем только после загрузки env.
const { hashPassword } = await import('../src/auth/password.js')
const { createUser, UserError } = await import('../src/db/users.js')
const { closeDb } = await import('../src/db/client.js')

try {
  const passwordHash = await hashPassword(password)
  const user = await createUser({
    login,
    passwordHash,
    role: role as (typeof ROLES)[number],
    firstName,
    lastName,
  })
  console.log(`✓ Created user '${user.login}' (role=${user.role}, id=${user.id})`)
} catch (err) {
  if (err instanceof UserError && err.code === 'duplicate_login') {
    fail(`Login '${login}' already exists`)
  }
  throw err
} finally {
  await closeDb()
}
