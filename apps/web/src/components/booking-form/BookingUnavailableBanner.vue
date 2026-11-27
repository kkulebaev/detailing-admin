<script lang="ts">
export type UnavailableBanner =
  | {
      kind: 'headers_mismatch'
      column_index: number
      expected: string
      observed: string
    }
  | { kind: 'not_configured'; message: string }
</script>

<script setup lang="ts">
// Баннер не закрывается: записать в таблицу все равно нельзя, пока API не перезапустят.
defineProps<{ banner: UnavailableBanner | null }>()
</script>

<template>
  <div
    v-if="banner && banner.kind === 'headers_mismatch'"
    class="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium"
    role="alert"
  >
    «Сервис временно недоступен: расхождение в заголовках таблицы. Столбец
    {{ banner.column_index + 1 }}: ожидается «{{ banner.expected }}», найдено «{{
      banner.observed
    }}». Исправьте заголовок в таблице или EXPECTED_HEADERS в коде и перезапустите API.»
  </div>
  <div
    v-else-if="banner && banner.kind === 'not_configured'"
    class="bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium"
    role="alert"
  >
    «Сервис не сконфигурирован: {{ banner.message }}. Проверьте серверные переменные окружения и
    перезапустите API.»
  </div>
</template>
