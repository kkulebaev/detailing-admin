<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  deleteSection as apiDeleteSection,
  deleteService as apiDeleteService,
  type PricelistSection,
  type PricelistSectionRow,
  type PricelistService,
} from '@/lib/pricelist-api'
import { useInvalidatePricelist, usePricelistQuery } from '@/lib/queries'
import SectionFormDialog from './SectionFormDialog.vue'
import ServiceFormDialog from './ServiceFormDialog.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const { data: queryData, error: queryError, asyncStatus } = usePricelistQuery()
const invalidatePricelist = useInvalidatePricelist()

const sections = computed<PricelistSection[]>(() => {
  const r = queryData.value
  return r?.ok ? r.sections : []
})

const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

const error = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке прайс-листа'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить прайс-лист'
})

const sectionDialogOpen = ref(false)
const sectionEditing = ref<PricelistSectionRow | null>(null)

const serviceDialogOpen = ref(false)
const serviceEditing = ref<PricelistService | null>(null)
const serviceDefaultSectionId = ref<number | null>(null)

type DeleteTarget =
  | { kind: 'section'; id: number; name: string }
  | { kind: 'service'; id: number; name: string }

const deleteDialogOpen = ref(false)
const deleteTarget = ref<DeleteTarget | null>(null)
const deleting = ref(false)

const totalServices = computed(() =>
  sections.value.reduce((acc, s) => acc + s.services.length, 0),
)

const priceFormatter = new Intl.NumberFormat('ru-RU')

function formatPrice(value: number): string {
  return `${priceFormatter.format(value)} ₽`
}

function openCreateSection() {
  sectionEditing.value = null
  sectionDialogOpen.value = true
}

function openEditSection(section: PricelistSection) {
  sectionEditing.value = { id: section.id, name: section.name }
  sectionDialogOpen.value = true
}

function openCreateService(defaultSectionId: number | null) {
  serviceEditing.value = null
  serviceDefaultSectionId.value = defaultSectionId
  serviceDialogOpen.value = true
}

function openEditService(svc: PricelistService) {
  serviceEditing.value = svc
  serviceDefaultSectionId.value = svc.sectionId
  serviceDialogOpen.value = true
}

function askDeleteSection(section: PricelistSection) {
  deleteTarget.value = { kind: 'section', id: section.id, name: section.name }
  deleteDialogOpen.value = true
}

function askDeleteService(svc: PricelistService) {
  deleteTarget.value = { kind: 'service', id: svc.id, name: svc.name }
  deleteDialogOpen.value = true
}

function onDeleteDialogOpenChange(v: boolean) {
  // Don't clear deleteTarget here — Reka's AlertDialogAction emits
  // update:open(false) synchronously alongside its @click, and the order
  // isn't guaranteed; clearing here can null out the target before
  // confirmDelete reads it. The dialog is hidden when closed, so leaving
  // the stale target around is harmless until the next ask*().
  deleteDialogOpen.value = v
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleting.value = true
  try {
    const result =
      target.kind === 'section'
        ? await apiDeleteSection(target.id)
        : await apiDeleteService(target.id)

    if (result.ok) {
      toast.success(target.kind === 'section' ? 'Раздел удалён' : 'Услуга удалена')
      deleteTarget.value = null
      deleteDialogOpen.value = false
      await invalidatePricelist()
      return
    }

    if (result.error === 'conflict' && result.reason === 'has_services') {
      toast.error('Сначала удалите услуги из раздела')
    } else if (result.error === 'not_found') {
      toast.error('Запись уже удалена')
      deleteTarget.value = null
      deleteDialogOpen.value = false
      await invalidatePricelist()
      return
    } else if (result.error === 'unavailable') {
      toast.error(result.message)
    } else {
      toast.error('Не удалось удалить')
    }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div>
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">Прайс-лист</h1>
          <p v-if="!loading && !error" class="mt-1 text-sm text-muted-foreground">
            Разделов: {{ sections.length }} · Услуг: {{ totalServices }}
          </p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" @click="openCreateSection">
            <Plus class="size-4" /> Раздел
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="sections.length === 0"
            @click="openCreateService(null)"
          >
            <Plus class="size-4" /> Услуга
          </Button>
        </div>
      </header>

      <Alert v-if="error" variant="destructive">
        <AlertTitle>Не удалось загрузить прайс-лист</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-else class="overflow-hidden rounded-md border border-border">
        <Table>
          <colgroup>
            <col class="w-72" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="hidden md:table-column" />
            <col class="w-24" />
          </colgroup>
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="px-4">Услуга</TableHead>
              <TableHead class="px-4 text-right">I кл.</TableHead>
              <TableHead class="px-4 text-right">II кл.</TableHead>
              <TableHead class="px-4 text-right">III кл.</TableHead>
              <TableHead class="px-4 text-right">IV кл.</TableHead>
              <TableHead class="hidden px-4 md:table-cell">Примечание</TableHead>
              <TableHead class="px-4 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 6" :key="i">
                <TableCell class="px-4"><Skeleton class="h-4 w-48" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="hidden px-4 md:table-cell"><Skeleton class="h-4 w-40" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
              </TableRow>
            </template>
            <TableEmpty v-else-if="sections.length === 0" :colspan="7">
              Прайс-лист пуст.
            </TableEmpty>
            <template v-else v-for="section in sections" :key="section.id">
              <TableRow class="bg-muted/30 hover:bg-muted/30">
                <TableHead
                  scope="colgroup"
                  colspan="7"
                  class="px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span>{{ section.name }}</span>
                    <div class="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-7"
                        @click="openCreateService(section.id)"
                      >
                        <Plus class="size-3.5" /> Услуга
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        :aria-label="`Редактировать раздел ${section.name}`"
                        @click="openEditSection(section)"
                      >
                        <Pencil class="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        :aria-label="`Удалить раздел ${section.name}`"
                        @click="askDeleteSection(section)"
                      >
                        <Trash2 class="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </TableHead>
              </TableRow>
              <TableRow
                v-for="svc in section.services"
                :key="svc.id"
                class="align-top"
              >
                <TableCell class="px-4 font-medium whitespace-normal">{{ svc.name }}</TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass1) }}
                </TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass2) }}
                </TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass3) }}
                </TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass4) }}
                </TableCell>
                <TableCell class="hidden px-4 text-xs text-muted-foreground whitespace-pre-line md:table-cell">
                  {{ svc.description || '' }}
                </TableCell>
                <TableCell class="px-4 text-right">
                  <div class="inline-flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="`Редактировать услугу ${svc.name}`"
                      @click="openEditService(svc)"
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :aria-label="`Удалить услугу ${svc.name}`"
                      @click="askDeleteService(svc)"
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </div>
    </div>

    <SectionFormDialog
      v-model:open="sectionDialogOpen"
      :section="sectionEditing"
      @saved="invalidatePricelist"
    />

    <ServiceFormDialog
      v-model:open="serviceDialogOpen"
      :service="serviceEditing"
      :default-section-id="serviceDefaultSectionId"
      :sections="sections"
      @saved="invalidatePricelist"
    />

    <AlertDialog
      :open="deleteDialogOpen"
      @update:open="onDeleteDialogOpenChange"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ deleteTarget?.kind === 'section' ? 'Удалить раздел?' : 'Удалить услугу?' }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="deleteTarget?.kind === 'section'">
              Раздел «{{ deleteTarget.name }}» будет удалён. Действие нельзя отменить.
              Удалить раздел можно только если в нём не осталось услуг
            </template>
            <template v-else-if="deleteTarget">
              Услуга «{{ deleteTarget.name }}» будет удалена. Действие нельзя отменить
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Отмена</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="confirmDelete">
            {{ deleting ? 'Удаление…' : 'Удалить' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
