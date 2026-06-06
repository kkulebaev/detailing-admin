<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useClipboard, useSorted } from '@vueuse/core'
import { ChevronDown, ChevronsUpDown, ChevronUp } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { fetchClients, type Client } from '@/lib/clients-api'

const rawClients = ref<Client[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const collator = new Intl.Collator('ru', { sensitivity: 'base' })

type SortKey = 'name' | 'phone'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('name')
const sortDir = ref<SortDir>('asc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const clients = useSorted(rawClients, (a, b) => {
  const dir = sortDir.value === 'asc' ? 1 : -1
  if (sortKey.value === 'name') {
    const aEmpty = a.name.length === 0
    const bEmpty = b.name.length === 0
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
    return collator.compare(a.name, b.name) * dir
  }
  return a.phone.localeCompare(b.phone) * dir
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

const { copy, isSupported: clipboardSupported } = useClipboard({ legacy: true })

function formatPhone(raw: string): string {
  const match = /^(.+?)(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(raw)
  if (!match) return raw
  const [, prefix, a, b, c, d] = match
  return `${prefix}-${a}-${b}-${c}-${d}`
}

async function copyPhone(phone: string) {
  const formatted = formatPhone(phone)
  if (!clipboardSupported.value) {
    toast.error('Копирование недоступно в этом браузере')
    return
  }
  try {
    await copy(formatted)
    toast.success('Телефон скопирован', { description: formatted })
  } catch {
    toast.error('Не удалось скопировать телефон')
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div class="mx-auto max-w-4xl">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold">Клиенты</h1>
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
              <th scope="col" class="px-4 py-2 font-medium">#</th>
              <th
                v-for="col in [
                  { key: 'name', label: 'Имя' },
                  { key: 'phone', label: 'Телефон' },
                ] as { key: SortKey; label: string }[]"
                :key="col.key"
                scope="col"
                class="px-4 py-2 font-medium"
                :aria-sort="
                  sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                "
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="{ 'text-foreground': sortKey === col.key }"
                  @click="toggleSort(col.key)"
                >
                  <span>{{ col.label }}</span>
                  <ChevronUp v-if="sortKey === col.key && sortDir === 'asc'" class="size-3.5" />
                  <ChevronDown
                    v-else-if="sortKey === col.key && sortDir === 'desc'"
                    class="size-3.5"
                  />
                  <ChevronsUpDown v-else class="size-3.5 opacity-50" />
                </button>
              </th>
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
              <td class="px-4 py-2 tabular-nums whitespace-nowrap">
                <button
                  type="button"
                  class="rounded px-1 py-0.5 text-left whitespace-nowrap hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :title="`Скопировать ${formatPhone(client.phone)}`"
                  @click="copyPhone(client.phone)"
                >
                  {{ formatPhone(client.phone) }}
                </button>
              </td>
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
