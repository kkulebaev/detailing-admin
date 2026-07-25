<script setup lang="ts">
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

// Minimal Command wired the same way ServicePicker uses it: a filter input over
// a flat list of items. Item text is what the filter matches against.
defineProps<{ items: { value: number; label: string }[] }>()
</script>

<template>
  <Command>
    <CommandInput placeholder="Найти услугу…" />
    <CommandList>
      <CommandEmpty>Ничего не найдено</CommandEmpty>
      <CommandGroup heading="Услуги">
        <CommandItem v-for="it in items" :key="it.value" :value="it.value">
          {{ it.label }}
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
</template>
