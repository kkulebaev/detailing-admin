// Shared helpers for the user provisioning CLIs (user-create / user-reset-password).
//
// Env: loads apps/api/.env when present (local dev) but never requires it — in
// prod the scripts run via `railway run`, which injects the service env straight
// into process.env. Callers must import env-dependent modules dynamically AFTER
// invoking loadLocalEnv(), mirroring gen-openapi.ts.
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '../.env'))
  } catch {
    // No .env — rely on the ambient process.env (container / railway run).
  }
}

/** Reads a single flag value: `--login foo` or `--login=foo`. */
export function getArg(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const eq = `--${name}=`
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === `--${name}`) return argv[i + 1]
    if (a.startsWith(eq)) return a.slice(eq.length)
  }
  return undefined
}

/** Prompts for a password on the TTY without echoing keystrokes. */
export function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void }
    let first = true
    rlAny._writeToOutput = () => {
      if (first) {
        process.stdout.write(prompt)
        first = false
      }
      // Swallow every echoed keystroke so the password never hits the terminal.
    }
    rl.question(prompt, (value) => {
      rl.close()
      process.stdout.write('\n')
      resolve(value)
    })
  })
}

export function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}
