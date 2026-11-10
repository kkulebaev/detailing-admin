// Общие хелперы для CLI заведения пользователей (user-create / user-reset-password).
//
// Env: загружает apps/api/.env, если он есть (локальная разработка), но не требует его —
// на проде скрипты запускаются через `railway run`, который кладет env сервиса прямо
// в process.env. Модули, зависящие от env, вызывающий код должен импортировать
// динамически ПОСЛЕ вызова loadLocalEnv(), как в gen-openapi.ts.
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '../.env'))
  } catch {
    // Нет .env — полагаемся на окружающий process.env (контейнер / railway run).
  }
}

/** Читает значение одного флага: `--login foo` или `--login=foo`. */
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

/** Запрашивает пароль в TTY, не отображая нажатия клавиш. */
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
      // Глотаем каждое эхо нажатия, чтобы пароль никогда не попал в терминал.
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
