<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchClients, type Client } from '@/lib/clients-api'

const rawClients = ref<Client[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const collator = new Intl.Collator('ru', { sensitivity: 'base' })

const clients = computed<Client[]>(() => {
  return [...rawClients.value].sort((a, b) => {
    const aEmpty = a.name.length === 0
    const bEmpty = b.name.length === 0
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
    const byName = collator.compare(a.name, b.name)
    if (byName !== 0) return byName
    return a.phone.localeCompare(b.phone)
  })
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await fetchClients()
    if (result.ok) {
      rawClients.value = result.clients
    } else if (result.error === 'unavailable') {
      error.value = result.message || 'База данных недоступна'
    } else {
      error.value = 'Не удалось загрузить список клиентов'
    }
  } catch {
    error.value = 'Сетевая ошибка при загрузке клиентов'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div class="mx-auto max-w-4xl">
      <header class="mb-6 flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold">Клиенты</h1>
        <button
          type="button"
          class="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? 'Загрузка…' : 'Обновить' }}
        </button>
      </header>

      <div v-if="loading" class="text-muted-foreground">Загрузка…</div>

      <div
        v-else-if="error"
        class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {{ error }}
      </div>

      <div v-else-if="clients.length === 0" class="text-muted-foreground">
        Список клиентов пуст.
      </div>

      <div v-else class="overflow-x-auto rounded-md border border-border">
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th class="px-4 py-2 font-medium">#</th>
              <th class="px-4 py-2 font-medium">Имя</th>
              <th class="px-4 py-2 font-medium">Телефон</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(client, idx) in clients"
              :key="client.id"
              class="border-t border-border"
            >
              <td class="px-4 py-2 text-muted-foreground tabular-nums">{{ idx + 1 }}</td>
              <td class="px-4 py-2">{{ client.name || '—' }}</td>
              <td class="px-4 py-2 tabular-nums">{{ client.phone }}</td>
            </tr>
          </tbody>
        </table>
        <div class="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          Всего: {{ clients.length }}
        </div>
      </div>
    </div>
  </div>
</template>
