<script setup lang="ts">
import { computed } from 'vue'
import { ConfigProvider } from 'reka-ui'
import { RouterView, useRoute } from 'vue-router'
import { Toaster } from '@/components/ui/sonner'
import AppLayout from '@/components/AppLayout.vue'

// /login рендерится без сайдбара и обвязки лейаута — пока сессии нет,
// переходить все равно некуда.
const route = useRoute()
const isPublic = computed(() => route.meta.public === true)
</script>

<template>
  <ConfigProvider :scroll-body="false">
    <Toaster position="top-center" richColors />
    <AppLayout v-if="!isPublic">
      <RouterView />
    </AppLayout>
    <RouterView v-else />
  </ConfigProvider>
</template>
