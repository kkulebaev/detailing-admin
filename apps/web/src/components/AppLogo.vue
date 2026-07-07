<script setup lang="ts">
withDefaults(defineProps<{ showText?: boolean }>(), { showText: true })
</script>

<template>
  <span class="flex items-center gap-2 min-w-0">
    <img
      src="/apple-touch-icon.png"
      alt="Dazzle Detailing"
      class="size-8 shrink-0 rounded-full"
    />
    <span v-if="showText" class="truncate font-semibold tracking-tight">
      Dazzle Detailing
    </span>
  </span>
</template>
