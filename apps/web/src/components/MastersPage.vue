<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Pencil, Plus, ShieldCheck, Trash2, Wrench } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  deleteMaster as apiDeleteMaster,
  reorderMasters as apiReorderMasters,
  type Master,
} from '@/lib/masters-api'
import {
  useInvalidateMasters,
  useInvalidateWorkRules,
  useMastersQuery,
  usePricelistQuery,
  useWorkRulesQuery,
} from '@/lib/queries'
import type { PricelistSection } from '@/lib/pricelist-api'
import type { WorkRule } from '@/lib/work-rules-api'
import { describeTarget, formatPay, sortByPricelist } from '@/lib/work-rules'
import MasterFormDialog from './MasterFormDialog.vue'
import MasterWorkRulesDialog from './MasterWorkRulesDialog.vue'
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

// Локальная изменяемая копия серверного списка, отсортированная по position.
// Перестановка оптимистично меняет соседей местами здесь, чтобы UI обновлялся
// сразу; при ошибке `reorderMasters` инвалидация заново синхронизирует массив.
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

const loading = computed(() => asyncStatus.value === 'loading' && queryData.value === undefined)

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке мастеров'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить список мастеров'
})

const dialogOpen = ref(false)
const editing = ref<Master | null>(null)

const { data: rulesData } = useWorkRulesQuery()
const invalidateWorkRules = useInvalidateWorkRules()
const { data: pricelistData } = usePricelistQuery()
const sections = computed<PricelistSection[]>(() =>
  pricelistData.value?.ok ? pricelistData.value.sections : [],
)

const rulesByMaster = computed(() => {
  const map = new Map<number, WorkRule[]>()
  const r = rulesData.value
  if (!r?.ok) return map
  for (const { masterId, ...rule } of r.rules) {
    const list = map.get(masterId) ?? []
    list.push(rule)
    map.set(masterId, list)
  }
  return map
})

const copySources = computed(() =>
  rows.value
    .filter((m) => m.id !== rulesTarget.value?.id && rulesOf(m).length > 0)
    .map((m) => ({ id: m.id, name: m.name, rules: rulesOf(m) })),
)

function rulesOf(master: Master): WorkRule[] {
  return rulesByMaster.value.get(master.id) ?? []
}

// Мастер может вести десяток правил: на узком экране полный список вытеснил бы строку с кнопками,
// поэтому показываем начало прайса, а остальное — в диалоге.
const SUMMARY_LIMIT = 3

function rulesSummary(master: Master): string {
  const parts = sortByPricelist(rulesOf(master), sections.value).map(
    (r) => `${describeTarget(r, sections.value).title} ${formatPay(r)}`,
  )
  const shown = parts.slice(0, SUMMARY_LIMIT).join(' · ')
  return parts.length > SUMMARY_LIMIT ? `${shown} · и еще ${parts.length - SUMMARY_LIMIT}` : shown
}

const rulesDialogOpen = ref(false)
const rulesTarget = ref<Master | null>(null)

function openRules(master: Master) {
  rulesTarget.value = master
  rulesDialogOpen.value = true
}

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
        result.error === 'unavailable' ? result.message : 'Не удалось изменить порядок'
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
      toast.success('Мастер удален')
      deleteDialogOpen.value = false
      await invalidateMasters()
      return
    }
    if (result.error === 'not_found') {
      // Уже удалено — пользователь этого и хотел; закрываем и обновляем.
      toast.error('Мастер уже удален')
      deleteDialogOpen.value = false
      await invalidateMasters()
      return
    }
    // Настоящая ошибка — оставляем диалог открытым и показываем причину в нем.
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
  <div class="text-foreground p-2 sm:p-8">
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
            <span
              v-if="rulesOf(master).length > 0"
              class="text-xs break-words text-muted-foreground"
              data-testid="work-rules-summary"
            >
              {{ rulesSummary(master) }}
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
              :aria-label="`Виды работ ${master.name}`"
              title="Виды работ и оплата"
              @click="openRules(master)"
            >
              <Wrench class="size-3.5" />
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

    <MasterFormDialog v-model:open="dialogOpen" :editing="editing" @saved="invalidateMasters" />

    <MasterWorkRulesDialog
      v-model:open="rulesDialogOpen"
      :master="rulesTarget"
      :rules="rulesTarget ? rulesOf(rulesTarget) : []"
      :sections="sections"
      :copy-sources="copySources"
      @saved="invalidateWorkRules"
    />

    <AlertDialog :open="deleteDialogOpen" @update:open="onDeleteDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить мастера?</AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget">
              Мастер «{{ deleteTarget.name }}» пропадет из списков, а его записи и зарплата
              сохранятся. Вернуть мастера можно только через базу данных
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Отмена</AlertDialogCancel>
          <!-- Обычный Button (не AlertDialogAction), чтобы диалог оставался открытым,
               пока запрос не завершится. Намеренно НЕ disabled: на отключенной кнопке
               в фокусе focus scope из reka-ui закрывается с задержкой ~1 с — от
               двойной отправки защищает guard повторного входа в confirmDelete. -->
          <Button @click="confirmDelete">
            {{ deleting ? 'Удаление…' : 'Удалить' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
