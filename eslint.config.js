// Flat config (ESLint ≥9). The single rule that earns its keep here is
// `@typescript-eslint/consistent-type-assertions` with `assertionStyle: 'never'`
// — bans `x as T` and `<T>x`. `as const` is a const assertion (different AST
// node) and remains allowed; that matters because the API routes pin literal
// success types via `ok: true as const`.
//
// Ignored on purpose:
//   - `apps/web/src/components/ui/**` — vendored shadcn-vue, third-party patterns
//   - `apps/api/scripts/**` — CLI seed scripts read JSON files into schemas
//   - `apps/api/src/sheets.ts` — googleapis error shapes have no clean Zod story
import tseslint from 'typescript-eslint'
import vitest from '@vitest/eslint-plugin'
import vue from 'eslint-plugin-vue'
import { importX } from 'eslint-plugin-import-x'
import vueParser from 'vue-eslint-parser'

const TEST_FILES = ['**/test/**/*.{ts,vue}']

const NO_TYPE_ASSERTIONS = {
  '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/drizzle/**',
      '**/.tmp/**',
      'apps/web/src/components/ui/**',
      'apps/web/src/lib/generated/**',
      'apps/api/scripts/**',
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
    files: ['**/*.{ts,vue}'],
    plugins: { 'import-x': importX },
    rules: { 'import-x/first': 'error' },
  },
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
    rules: {
      ...NO_TYPE_ASSERTIONS,
      // A <button> without a type submits its form when clicked.
      'vue/html-button-has-type': 'error',
      'vue/no-undef-components': ['error', { ignorePatterns: ['^RouterLink$', '^RouterView$'] }],
      'vue/no-undef-properties': 'error',
    },
  },
  {
    files: ['**/e2e/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-assertions': 'off' },
  },
  {
    ...vitest.configs.recommended,
    files: TEST_FILES,
    rules: {
      ...vitest.configs.recommended.rules,
      // Mock casts are part of the testing toolkit.
      '@typescript-eslint/consistent-type-assertions': 'off',
      // `vi.mock` conventionally precedes the imports it affects; vitest hoists it.
      'import-x/first': 'off',
      // The preset only warns, and a warning doesn't fail `pnpm lint`: with no CI a
      // forgotten `it.skip` would stay switched off without anyone noticing.
      'vitest/no-disabled-tests': 'error',
    },
  },
)
