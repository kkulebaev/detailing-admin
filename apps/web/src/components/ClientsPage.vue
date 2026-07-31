<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Inbox,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
  X,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  deleteClient as apiDeleteClient,
  type Client,
  type GetApiClientsParams,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const LIMIT = 50

const COLUMN_COUNT = 5

// ── Filter / sort / paging state ────────────────────────────────────────────
const searchInput = ref('')
// Manual debounce (instead of refDebounced) so `resetFilters` can flush it
// synchronously — otherwise the query keeps the stale search term for 300ms
// after a reset and the table flashes its empty state before real rows load.
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (searchDebounced.value = v), 300)
})
onUnmounted(() => clearTimeout(searchTimer))

type SortColumn = 'name' | 'phone' | 'createdAt'
const sort = ref<SortColumn>('name')
const dir = ref<'asc' | 'desc'>('asc')
const offset = ref(0)

const params = computed<GetApiClientsParams>(() => ({
  limit: LIMIT,
  offset: offset.value,
  q: searchDebounced.value.trim() || undefined,
  sort: sort.value,
  dir: dir.value,
}))

// Any filter/sort change returns to the first page; paging itself moves `offset`
// directly and is intentionally excluded here.
watch([searchDebounced, sort, dir], () => {
  offset.value = 0
})

const { data: queryData, error: queryError, asyncStatus } = useClientsQuery(params)
const invalidateClients = useInvalidateClients()

const data = computed<Client[]>(() => {
  const r = queryData.value
  return r?.ok ? r.clients : []
})

const total = computed(() => {
  const r = queryData.value
  return r?.ok ? r.total : 0
})

// Skeleton only on the very first load — background refetches keep the previous
// rows visible (placeholderData in useClientsQuery), so `loading` is false then.
const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

// Delay the skeleton so a fast first load doesn't flash it — only show it if the
// initial load is genuinely slow (>200ms).
const showSkeleton = ref(false)
let skeletonTimer: ReturnType<typeof setTimeout> | undefined
watch(
  loading,
  (isLoading) => {
    clearTimeout(skeletonTimer)
    if (isLoading) skeletonTimer = setTimeout(() => (showSkeleton.value = true), 200)
    else showSkeleton.value = false
  },
  { immediate: true },
)
onUnmounted(() => clearTimeout(skeletonTimer))

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке клиентов'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить список клиентов'
})

// ── Sorting ─────────────────────────────────────────────────────────────────
function sortState(col: SortColumn): 'asc' | 'desc' | false {
  return sort.value === col ? dir.value : false
}

// First click on a column sorts it ascending; clicking the active column flips
// direction. There is no "unsorted" state — the list is always ordered.
function toggleSort(col: SortColumn) {
  if (sort.value === col) {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sort.value = col
    dir.value = 'asc'
  }
}

function ariaSortFor(state: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (state === 'asc') return 'ascending'
  if (state === 'desc') return 'descending'
  return 'none'
}

// ── Pagination ──────────────────────────────────────────────────────────────
const canPrev = computed(() => offset.value > 0)
const canNext = computed(() => offset.value + LIMIT < total.value)
const rangeStart = computed(() => (total.value === 0 ? 0 : offset.value + 1))
const rangeEnd = computed(() => Math.min(offset.value + LIMIT, total.value))

function prevPage() {
  offset.value = Math.max(0, offset.value - LIMIT)
}

function nextPage() {
  if (canNext.value) offset.value += LIMIT
}

// ── Empty / reset ───────────────────────────────────────────────────────────
const isEmpty = computed(
  () =>
    asyncStatus.value !== 'loading' &&
    !showSkeleton.value &&
    !loading.value &&
    data.value.length === 0,
)

const hasActiveFilters = computed(() => searchInput.value.trim() !== '')

function resetFilters() {
  searchInput.value = ''
  // Flush the debounce so the query drops the search term this tick, not 300ms
  // later — keeps the empty state from flashing during reset.
  clearTimeout(searchTimer)
  searchDebounced.value = ''
}

// ── Row actions / dialogs ───────────────────────────────────────────────────
const dialogOpen = ref(false)
const editing = ref<Client | null>(null)

const deleteDialogOpen = ref(false)
const deleteTarget = ref<Client | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const { copy, isSupported: clipboardSupported } = useClipboard({ legacy: true })

function formatPhone(raw: string): string {
  const match = /^(.+?)(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(raw)
  if (!match) return raw
  const [, prefix, a, b, c, d] = match
  return `${prefix}-${a}-${b}-${c}-${d}`
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
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
    if (result.error === 'conflict') {
      deleteError.value =
        'У клиента есть записи. Сначала удалите или перенесите его записи, затем удалите клиента.'
    } else {
      deleteError.value =
        result.error === 'unavailable' ? result.message : 'Не удалось удалить клиента'
    }
  } catch {
    deleteError.value = 'Не удалось удалить клиента'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <!-- Mobile: normal page flow (few rows fit — let the whole page scroll).
       md+: fixed-height flex column so only the rows scroll internally. -->
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8 md:flex md:h-svh md:flex-col">
    <div class="md:flex md:min-h-0 md:flex-1 md:flex-col">
      <header class="mb-6 shrink-0">
        <h1 class="text-2xl font-semibold">Клиенты</h1>
      </header>

      <!-- Filters -->
      <div class="mb-4 shrink-0 flex flex-wrap items-end gap-3">
        <div class="flex flex-1 flex-col gap-1">
          <span class="text-xs text-muted-foreground">Поиск</span>
          <div class="relative">
            <Search
              class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="searchInput"
              type="search"
              class="h-9 pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
              placeholder="Имя или телефон"
            />
            <button
              v-if="searchInput"
              type="button"
              aria-label="Очистить поиск"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
              @click="searchInput = ''"
            >
              <X class="size-4" />
            </button>
          </div>
        </div>

        <Button
          v-if="hasActiveFilters"
          variant="ghost"
          size="sm"
          class="gap-1 text-muted-foreground"
          @click="resetFilters"
        >
          <X class="size-4" /> Сбросить
        </Button>

        <Button variant="outline" size="sm" @click="openCreate">
          <Plus class="size-4" /> Клиент
        </Button>
      </div>

      <Alert v-if="error" variant="destructive" class="shrink-0">
        <AlertTitle>Не удалось загрузить клиентов</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <Table
        v-else
        container-class="rounded-md border border-border md:min-h-0 md:flex-1"
        :class="[{ 'table-fixed min-w-176': !isEmpty, 'h-full': isEmpty }]"
      >
        <colgroup v-if="!isEmpty">
          <col class="w-16" />
          <col />
          <col class="w-56" />
          <col class="w-36" />
          <col class="w-28" />
        </colgroup>
        <TableHeader v-if="!isEmpty" class="sticky top-0 z-10 bg-muted">
          <TableRow>
            <TableHead class="px-4">#</TableHead>
            <TableHead class="px-4" :aria-sort="ariaSortFor(sortState('name'))">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="{ 'text-foreground': sortState('name') }"
                @click="toggleSort('name')"
              >
                Имя
                <ChevronUp v-if="sortState('name') === 'asc'" class="size-3.5" />
                <ChevronDown v-else-if="sortState('name') === 'desc'" class="size-3.5" />
                <ChevronsUpDown v-else class="size-3.5 opacity-50" />
              </button>
            </TableHead>
            <TableHead class="px-4" :aria-sort="ariaSortFor(sortState('phone'))">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="{ 'text-foreground': sortState('phone') }"
                @click="toggleSort('phone')"
              >
                Телефон
                <ChevronUp v-if="sortState('phone') === 'asc'" class="size-3.5" />
                <ChevronDown v-else-if="sortState('phone') === 'desc'" class="size-3.5" />
                <ChevronsUpDown v-else class="size-3.5 opacity-50" />
              </button>
            </TableHead>
            <TableHead class="px-4" :aria-sort="ariaSortFor(sortState('createdAt'))">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="{ 'text-foreground': sortState('createdAt') }"
                @click="toggleSort('createdAt')"
              >
                Добавлен
                <ChevronUp v-if="sortState('createdAt') === 'asc'" class="size-3.5" />
                <ChevronDown v-else-if="sortState('createdAt') === 'desc'" class="size-3.5" />
                <ChevronsUpDown v-else class="size-3.5 opacity-50" />
              </button>
            </TableHead>
            <TableHead class="px-4 text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="showSkeleton">
            <TableRow v-for="i in 8" :key="i">
              <TableCell class="px-4"><Skeleton class="h-4 w-6" /></TableCell>
              <TableCell class="px-4"><Skeleton class="h-4 w-40" /></TableCell>
              <TableCell class="px-4"><Skeleton class="h-4 w-32" /></TableCell>
              <TableCell class="px-4"><Skeleton class="h-4 w-20" /></TableCell>
              <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
            </TableRow>
          </template>
          <TableEmpty
            v-else-if="isEmpty"
            :colspan="COLUMN_COUNT"
            class="whitespace-normal"
          >
            <Empty class="gap-4 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <component :is="hasActiveFilters ? SearchX : Inbox" />
                </EmptyMedia>
                <EmptyTitle>
                  {{ hasActiveFilters ? 'Ничего не найдено' : 'Пока нет клиентов' }}
                </EmptyTitle>
                <EmptyDescription>
                  {{
                    hasActiveFilters
                      ? 'Попробуйте изменить условия или сбросить фильтры'
                      : 'Клиенты появятся здесь после первой записи'
                  }}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent v-if="hasActiveFilters">
                <Button variant="outline" size="sm" class="gap-1" @click="resetFilters">
                  <X class="size-4" /> Сбросить фильтры
                </Button>
              </EmptyContent>
            </Empty>
          </TableEmpty>
          <TableRow v-else v-for="(row, idx) in data" :key="row.id">
            <TableCell class="px-4 text-muted-foreground tabular-nums">
              {{ offset + idx + 1 }}
            </TableCell>
            <TableCell class="px-4">{{ row.name || '—' }}</TableCell>
            <TableCell class="px-4 tabular-nums">
              <button
                type="button"
                class="rounded px-1 py-0.5 text-left whitespace-nowrap hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :title="`Скопировать ${formatPhone(row.phone)}`"
                @click="copyPhone(row.phone)"
              >
                {{ formatPhone(row.phone) }}
              </button>
            </TableCell>
            <TableCell class="px-4 tabular-nums text-muted-foreground">
              {{ formatCreatedAt(row.createdAt) }}
            </TableCell>
            <TableCell class="px-4 text-right">
              <div class="inline-flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Редактировать клиента ${row.name || row.phone}`"
                  @click="openEdit(row)"
                >
                  <Pencil class="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Удалить клиента ${row.name || row.phone}`"
                  @click="askDelete(row)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <!-- Pagination -->
      <div
        v-if="!error"
        class="mt-4 shrink-0 flex flex-wrap items-center justify-between gap-3"
      >
        <p class="text-sm text-muted-foreground tabular-nums">
          <template v-if="total > 0">
            {{ rangeStart }}–{{ rangeEnd }} из {{ total }}
          </template>
          <template v-else>Всего: 0</template>
        </p>
        <div class="inline-flex gap-2">
          <Button
            variant="outline"
            size="sm"
            class="gap-1"
            :disabled="!canPrev || loading"
            @click="prevPage"
          >
            <ChevronLeft class="size-4" /> Назад
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="gap-1"
            :disabled="!canNext || loading"
            @click="nextPage"
          >
            Вперед <ChevronRight class="size-4" />
          </Button>
        </div>
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
