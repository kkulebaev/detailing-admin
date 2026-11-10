// Меняет роль существующей учетной записи. Использование:
//   pnpm --filter @detailing-admin/api user:set-role --login <login> --role <admin|booker|employee>
// Прод: добавьте в начало `railway run`.
import { ROLES, roleSchema } from '@detailing-admin/shared'
import { getArg, loadLocalEnv, fail } from './user-cli.js'

loadLocalEnv()

const login = getArg('login')
const role = roleSchema.safeParse(getArg('role'))

if (!login) fail('Missing --login')
if (!role.success) fail(`Missing or invalid --role (expected one of: ${ROLES.join(', ')})`)

const { setRoleByLogin } = await import('../src/db/users.js')
const { closeDb } = await import('../src/db/client.js')

try {
  const ok = await setRoleByLogin(login, role.data)
  if (!ok) fail(`No user with login '${login}'`)
  // Роль живет в JWT, а /me перевыпускает его из старых claims, поэтому изменение
  // доходит до активной сессии только через новый вход.
  console.log(`✓ Set role '${role.data}' for '${login}'. It applies after the user logs in again.`)
} finally {
  await closeDb()
}
