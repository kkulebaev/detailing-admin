<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { ChevronDown, ChevronsUpDown, ChevronUp } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  type ColumnDef,
  FlexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useVueTable,
} from '@tanstack/vue-table'
import { fetchClients, type Client } from '@/lib/clients-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const data = ref<Client[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const sorting = ref<SortingState>([{ id: 'name', desc: false }])

const collator = new Intl.Collator('ru', { sensitivity: 'base' })

const columns: ColumnDef<Client>[] = [
  {
    accessorKey: 'name',
    header: 'Имя',
    sortingFn: (a, b) => {
      const an = a.original.name
      const bn = b.original.name
      const aEmpty = an.length === 0
      const bEmpty = bn.length === 0
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
      return collator.compare(an, bn)
    },
  },
  {
    accessorKey: 'phone',
    header: 'Телефон',
    sortingFn: (a, b) => a.original.phone.localeCompare(b.original.phone),
  },
]

const table = useVueTable({
  get data() {
    return data.value
  },
  columns,
  state: {
    get sorting() {
      return sorting.value
    },
  },
  enableSortingRemoval: false,
  getRowId: (row) => row.id,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  onSortingChange: (updater) => {
    sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
  },
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await fetchClients()
    if (result.ok) {
      data.value = result.clients
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

function ariaSortFor(state: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (state === 'asc') return 'ascending'
  if (state === 'desc') return 'descending'
  return 'none'
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div class="mx-auto max-w-4xl">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold">Клиенты</h1>
      </header>

      <Alert v-if="error" variant="destructive">
        <AlertTitle>Не удалось загрузить клиентов</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-else class="overflow-hidden rounded-md border border-border">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow
              v-for="headerGroup in table.getHeaderGroups()"
              :key="headerGroup.id"
            >
              <TableHead class="px-4">#</TableHead>
              <TableHead
                v-for="header in headerGroup.headers"
                :key="header.id"
                class="px-4"
                :aria-sort="ariaSortFor(header.column.getIsSorted())"
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="{ 'text-foreground': header.column.getIsSorted() }"
                  @click="header.column.toggleSorting()"
                >
                  <FlexRender
                    :render="header.column.columnDef.header"
                    :props="header.getContext()"
                  />
                  <ChevronUp
                    v-if="header.column.getIsSorted() === 'asc'"
                    class="size-3.5"
                  />
                  <ChevronDown
                    v-else-if="header.column.getIsSorted() === 'desc'"
                    class="size-3.5"
                  />
                  <ChevronsUpDown v-else class="size-3.5 opacity-50" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 5" :key="i">
                <TableCell class="px-4"><Skeleton class="h-4 w-6" /></TableCell>
                <TableCell class="px-4"><Skeleton class="h-4 w-40" /></TableCell>
                <TableCell class="px-4"><Skeleton class="h-4 w-32" /></TableCell>
              </TableRow>
            </template>
            <TableEmpty v-else-if="data.length === 0" :colspan="3">
              Список клиентов пуст.
            </TableEmpty>
            <TableRow
              v-else
              v-for="(row, idx) in table.getRowModel().rows"
              :key="row.id"
            >
              <TableCell class="px-4 text-muted-foreground tabular-nums">
                {{ idx + 1 }}
              </TableCell>
              <TableCell class="px-4">{{ row.original.name || '—' }}</TableCell>
              <TableCell class="px-4 tabular-nums">
                <button
                  type="button"
                  class="rounded px-1 py-0.5 text-left whitespace-nowrap hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :title="`Скопировать ${formatPhone(row.original.phone)}`"
                  @click="copyPhone(row.original.phone)"
                >
                  {{ formatPhone(row.original.phone) }}
                </button>
              </TableCell>
            </TableRow>
          </TableBody>
          <TableFooter v-if="!loading && data.length > 0" class="bg-muted/30">
            <TableRow>
              <TableCell colspan="3" class="px-4 text-xs text-muted-foreground">
                Всего: {{ data.length }}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  </div>
</template>
