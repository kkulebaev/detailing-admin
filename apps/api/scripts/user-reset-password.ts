// Resets an existing account's password. Usage:
//   pnpm --filter @detailing-admin/api user:reset-password --login <login>
// Prompts for the new password (hidden). Prod: prefix with `railway run`.
import { getArg, readHidden, loadLocalEnv, fail } from './user-cli.js'

loadLocalEnv()

const login = getArg('login')
if (!login) fail('Missing --login')

const password = await readHidden('New password: ')
if (password.length < 8) fail('Password must be at least 8 characters')
const confirm = await readHidden('Confirm new password: ')
if (password !== confirm) fail('Passwords do not match')

const { hashPassword } = await import('../src/auth/password.js')
const { resetPasswordByLogin } = await import('../src/db/users.js')
const { closeDb } = await import('../src/db/client.js')

try {
  const passwordHash = await hashPassword(password)
  const ok = await resetPasswordByLogin(login, passwordHash)
  if (!ok) fail(`No user with login '${login}'`)
  console.log(`✓ Reset password for '${login}'`)
} finally {
  await closeDb()
}
