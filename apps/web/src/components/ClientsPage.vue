<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { ChevronDown, ChevronsUpDown, ChevronUp, Pencil, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  type ColumnDef,
  FlexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useVueTable,
} from '@tanstack/vue-table'
import {
  deleteClient as apiDeleteClient,
  type Client,
} from '@/lib/clients-api'
import { useClientsQuery, useInvalidateClients } from '@/lib/queries'
import ClientFormDialog from './ClientFormDialog.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
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

const { data: queryData, error: queryError, asyncStatus } = useClientsQuery()
const invalidateClients = useInvalidateClients()

const data = computed<Client[]>(() => {
  const r = queryData.value
  return r?.ok ? r.clients : []
})

// Show skeleton only on the initial load — background refetches keep the
// existing rows visible.
const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке клиентов'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить список клиентов'
})

const sorting = ref<SortingState>([{ id: 'name', desc: false }])

const dialogOpen = ref(false)
const editing = ref<Client | null>(null)

const deleteDialogOpen = ref(false)
const deleteTarget = ref<Client | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

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

function openCreate() {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(client: Client) {
  editing.value = client
  dialogOpen.value = true
}

function askDelete(client: Client) {
  deleteTarget.value = client
  deleteError.value = null
  deleteDialogOpen.value = true
}

function onDeleteDialogOpenChange(v: boolean) {
  deleteDialogOpen.value = v
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  deleteError.value = null
  deleting.value = true
  try {
    const result = await apiDeleteClient(target.id)
    if (result.ok) {
      toast.success('Клиент удалён')
      deleteDialogOpen.value = false
      await invalidateClients()
      return
    }
    if (result.error === 'not_found') {
      // Already gone — the outcome the user wanted; close and refresh.
      toast.error('Клиент уже удалён')
      deleteDialogOpen.value = false
      await invalidateClients()
      return
    }
    // Real failure — keep the dialog open and surface the reason inside it.
    deleteError.value =
      result.error === 'unavailable' ? result.message : 'Не удалось удалить клиента'
  } catch {
    deleteError.value = 'Не удалось удалить клиента'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div>
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1 class="text-2xl font-semibold">Клиенты</h1>
        <Button variant="outline" size="sm" @click="openCreate">
          <Plus class="size-4" /> Клиент
        </Button>
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
              <TableHead class="px-4 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 5" :key="i">
                <TableCell class="px-4"><Skeleton class="h-4 w-6" /></TableCell>
                <TableCell class="px-4"><Skeleton class="h-4 w-40" /></TableCell>
                <TableCell class="px-4"><Skeleton class="h-4 w-32" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
              </TableRow>
            </template>
            <TableEmpty v-else-if="data.length === 0" :colspan="4">
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
              <TableCell class="px-4 text-right">
                <div class="inline-flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`Редактировать клиента ${row.original.name || row.original.phone}`"
                    @click="openEdit(row.original)"
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="`Удалить клиента ${row.original.name || row.original.phone}`"
                    @click="askDelete(row.original)"
                  >
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
          <TableFooter v-if="!loading && data.length > 0" class="bg-muted/30">
            <TableRow>
              <TableCell colspan="4" class="px-4 text-xs text-muted-foreground">
                Всего: {{ data.length }}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>

    <ClientFormDialog
      v-model:open="dialogOpen"
      :client="editing"
      @saved="invalidateClients"
    />

    <AlertDialog
      :open="deleteDialogOpen"
      @update:open="onDeleteDialogOpenChange"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить клиента?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              Клиент «{{ deleteTarget.name || formatPhone(deleteTarget.phone) }}»
              будет удалён. Действие нельзя отменить
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Отмена</AlertDialogCancel>
          <!-- Plain Button (not AlertDialogAction) so the dialog stays open until
               the request resolves. Deliberately NOT disabled: a disabled, focused
               button makes reka-ui's focus scope lag the close by ~1s — a
               re-entrancy guard in confirmDelete prevents double submits instead. -->
          <Button @click="confirmDelete">
            {{ deleting ? 'Удаление…' : 'Удалить' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
