<script setup lang="ts">
import { computed } from 'vue'
import { ConfigProvider } from 'reka-ui'
import { RouterView, useRoute } from 'vue-router'
import { Toaster } from '@/components/ui/sonner'
import AppLayout from '@/components/AppLayout.vue'

// /login renders without the sidebar/layout chrome — there's nothing to
// navigate to before a session exists.
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
