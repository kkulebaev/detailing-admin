<script setup lang="ts">
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

// Минимальный Command, собранный так же, как в ServicePicker: поле фильтра над
// плоским списком пунктов. Фильтр сопоставляет с текстом пункта.
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
