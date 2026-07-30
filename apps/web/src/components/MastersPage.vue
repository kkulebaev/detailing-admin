<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Pencil, Plus, ShieldCheck, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  deleteMaster as apiDeleteMaster,
  reorderMasters as apiReorderMasters,
  type Master,
} from '@/lib/masters-api'
import { useInvalidateMasters, useMastersQuery } from '@/lib/queries'
import MasterFormDialog from './MasterFormDialog.vue'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const { data: queryData, error: queryError, asyncStatus } = useMastersQuery()
const invalidateMasters = useInvalidateMasters()

// Local, mutable copy of the server list kept sorted by position. Reorder does
// optimistic adjacent swaps here so the UI updates instantly; a failed
// `reorderMasters` call falls back to invalidation which re-syncs this array.
const rows = ref<Master[]>([])

watch(
  queryData,
  (r) => {
    if (r?.ok) {
      rows.value = [...r.masters].sort((a, b) => a.position - b.position || a.id - b.id)
    }
  },
  { immediate: true },
)

const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке мастеров'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить список мастеров'
})

const dialogOpen = ref(false)
const editing = ref<Master | null>(null)

const deleteDialogOpen = ref(false)
const deleteTarget = ref<Master | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const reordering = ref(false)

function openCreate() {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(master: Master) {
  editing.value = master
  dialogOpen.value = true
}

async function move(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= rows.value.length) return
  const next = [...rows.value]
  const tmp = next[index]!
  next[index] = next[target]!
  next[target] = tmp
  rows.value = next
  reordering.value = true
  try {
    const ids = next.map((m) => m.id)
    const result = await apiReorderMasters(ids)
    if (!result.ok) {
      const message =
        result.error === 'unavailable'
          ? result.message
          : 'Не удалось изменить порядок'
      toast.error(message)
      await invalidateMasters()
    }
  } catch {
    toast.error('Не удалось изменить порядок')
    await invalidateMasters()
  } finally {
    reordering.value = false
  }
}

function askDelete(master: Master) {
  deleteTarget.value = master
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
    const result = await apiDeleteMaster(target.id)
    if (result.ok) {
      toast.success('Мастер удалён')
      deleteDialogOpen.value = false
      await invalidateMasters()
      return
    }
    if (result.error === 'not_found') {
      // Already gone — the outcome the user wanted; close and refresh.
      toast.error('Мастер уже удалён')
      deleteDialogOpen.value = false
      await invalidateMasters()
      return
    }
    // Real failure — keep the dialog open and surface the reason inside it.
    deleteError.value =
      result.error === 'unavailable' ? result.message : 'Не удалось удалить мастера'
  } catch {
    deleteError.value = 'Не удалось удалить мастера'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div>
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1 class="text-2xl font-semibold">Мастера</h1>
        <Button variant="outline" size="sm" @click="openCreate">
          <Plus class="size-4" /> Добавить
        </Button>
      </header>

      <Alert v-if="error" variant="destructive">
        <AlertTitle>Не удалось загрузить мастеров</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-else class="overflow-hidden rounded-md border border-border">
        <template v-if="loading">
          <div
            v-for="i in 5"
            :key="i"
            class="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <Skeleton class="h-4 w-40 flex-1" />
            <Skeleton class="h-4 w-16" />
            <Skeleton class="h-4 w-24" />
          </div>
        </template>

        <p
          v-else-if="rows.length === 0"
          class="px-4 py-8 text-center text-sm text-muted-foreground"
        >
          Список мастеров пуст.
        </p>

        <div
          v-else
          v-for="(master, idx) in rows"
          :key="master.id"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-b-0"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">{{ master.name }}</span>
            <span v-if="master.telegramId" class="truncate text-xs text-muted-foreground">
              TG: {{ master.telegramId }}
            </span>
          </div>

          <Badge
            v-if="master.canBeResponsible"
            variant="secondary"
            class="gap-1"
            title="Ответственный"
          >
            <ShieldCheck class="size-3.5" />
            <span class="hidden sm:inline">Ответственный</span>
          </Badge>

          <div class="ml-auto inline-flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="idx === 0 || reordering"
              :aria-label="`Поднять ${master.name}`"
              @click="move(idx, -1)"
            >
              <ChevronUp class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="idx === rows.length - 1 || reordering"
              :aria-label="`Опустить ${master.name}`"
              @click="move(idx, 1)"
            >
              <ChevronDown class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Редактировать ${master.name}`"
              @click="openEdit(master)"
            >
              <Pencil class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Удалить ${master.name}`"
              @click="askDelete(master)"
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <MasterFormDialog
      v-model:open="dialogOpen"
      :editing="editing"
      @saved="invalidateMasters"
    />

    <AlertDialog :open="deleteDialogOpen" @update:open="onDeleteDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить мастера?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              Мастер «{{ deleteTarget.name }}» будет удалён. Действие нельзя отменить
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
