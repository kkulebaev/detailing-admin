// Flat config (ESLint ≥9). The single rule that earns its keep here is
// `@typescript-eslint/consistent-type-assertions` with `assertionStyle: 'never'`
// — bans `x as T` and `<T>x`. `as const` is a const assertion (different AST
// node) and remains allowed; that matters because the API routes pin literal
// success types via `ok: true as const`.
//
// Ignored on purpose:
//   - `apps/web/src/components/ui/**` — vendored shadcn-vue, third-party patterns
//   - `**/test/**`, `**/*.test.ts` — mock casts are part of the testing toolkit
//   - `apps/api/scripts/**` — CLI seed scripts read JSON files into schemas
//   - `apps/api/src/sheets.ts` — googleapis error shapes have no clean Zod story
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const NO_TYPE_ASSERTIONS = {
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    { assertionStyle: 'never' },
  ],
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/drizzle/**',
      '**/.tmp/**',
      'apps/web/src/components/ui/**',
      'apps/api/scripts/**',
      '**/test/**',
      '**/*.test.ts',
      '**/*.config.{ts,js,cjs,mjs}',
      '**/vite-env.d.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: NO_TYPE_ASSERTIONS,
  },
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    plugins: { '@typescript-eslint': tseslint.plugin, vue },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: NO_TYPE_ASSERTIONS,
  },
)
