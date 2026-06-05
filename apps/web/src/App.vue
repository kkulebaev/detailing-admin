<script setup lang="ts">
import { ConfigProvider } from 'reka-ui'
import { RouterView } from 'vue-router'
import { Toaster } from '@/components/ui/sonner'
import AppLayout from '@/components/AppLayout.vue'
</script>

<template>
  <ConfigProvider :scroll-body="false">
    <Toaster position="top-center" richColors />
    <AppLayout>
      <RouterView />
    </AppLayout>
  </ConfigProvider>
</template>
