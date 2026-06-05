<script setup lang="ts">
import { ConfigProvider } from 'reka-ui'
import BookingForm from '@/components/BookingForm.vue'
import { Toaster } from '@/components/ui/sonner'
</script>

<template>
  <ConfigProvider :scroll-body="false">
    <Toaster position="top-center" richColors />
    <BookingForm />
  </ConfigProvider>
</template>
