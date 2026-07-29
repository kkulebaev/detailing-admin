<script setup lang="ts">
import { Wrench } from '@lucide/vue'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <Card class="max-w-md mx-auto mt-12">
      <CardHeader class="items-center text-center gap-2">
        <Wrench class="size-8 text-muted-foreground" />
        <CardTitle>Раздел в разработке</CardTitle>
        <CardDescription>Функциональность для сотрудников появится позже.</CardDescription>
      </CardHeader>
    </Card>
  </div>
</template>
