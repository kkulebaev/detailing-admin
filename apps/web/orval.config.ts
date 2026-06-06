import { defineConfig } from 'orval'

// Generates a typed `fetch`-based client from the OpenAPI document committed
// at apps/web/openapi.json. The doc itself is produced by
// `pnpm --filter @detailing-admin/api gen:openapi` — regenerate it whenever a
// route, request schema, or response schema changes, then run `pnpm gen:client`.
//
// The custom mutator (`orval-mutator.ts`) prepends the env-driven API base URL,
// so generated URLs stay relative and the dev Vite proxy keeps working.
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
        mutator: {
          path: './src/lib/orval-mutator.ts',
          name: 'orvalFetch',
        },
      },
    },
  },
})
