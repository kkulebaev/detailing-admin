// Flat config (ESLint ≥9). Единственное правило, которое здесь реально окупается, —
// `@typescript-eslint/consistent-type-assertions` с `assertionStyle: 'never'`:
// запрещает `x as T` и `<T>x`. `as const` — это const assertion (другой узел AST)
// и остаётся разрешённым; это важно, потому что роуты API закрепляют литеральные
// типы успеха через `ok: true as const`.
//
// Намеренно игнорируются:
//   - `apps/web/src/components/ui/**` — вендоренный shadcn-vue, сторонние паттерны
//   - `apps/api/scripts/**` — CLI-скрипты сидов читают JSON-файлы в схемы
//   - `apps/api/src/sheets.ts` — для форм ошибок googleapis нет чистого решения на Zod
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
      // <button> без type при клике отправляет свою форму.
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
      // Приведения типов в моках — часть инструментария тестов.
      '@typescript-eslint/consistent-type-assertions': 'off',
      // `vi.mock` по соглашению стоит перед импортами, на которые влияет; vitest его поднимает.
      'import-x/first': 'off',
      // Пресет лишь предупреждает, а предупреждение не валит `pnpm lint`: без CI забытый
      // `it.skip` так и остался бы выключенным, и никто бы не заметил.
      'vitest/no-disabled-tests': 'error',
    },
  },
)
