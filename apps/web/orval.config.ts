import { defineConfig } from 'orval'

// Генерирует типизированный клиент на `fetch` из документа OpenAPI, закоммиченного
// в apps/web/openapi.json. Сам документ создает
// `pnpm --filter @detailing-admin/api gen:openapi` — перегенерируйте его при любом
// изменении роута, схемы запроса или ответа, затем запустите `pnpm gen:client`.
//
// Собственный mutator (`orval-mutator.ts`) добавляет в начало базовый URL API из env,
// поэтому сгенерированные URL остаются относительными и dev-прокси Vite продолжает работать.
export default defineConfig({
  detailingAdmin: {
    input: {
      target: './openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/lib/generated/endpoints.ts',
      schemas: './src/lib/generated/model',
      client: 'fetch',
      clean: true,
      baseUrl: '',
      override: {
        // Генерируем `type X = 'A' | 'B'` / `type X = 1 | 2 | 3 | 4` вместо приема
        // по умолчанию `const X = { ... } as const` + `typeof X[keyof typeof X]` —
        // мы никогда не обращаемся к рантайм-объекту констант напрямую.
        enumGenerationType: 'union',
        mutator: {
          path: './src/lib/orval-mutator.ts',
          name: 'orvalFetch',
        },
      },
    },
  },
})
