<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Info, Pencil, Plus, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useMediaQuery } from '@vueuse/core'
import {
  deleteSection as apiDeleteSection,
  deleteService as apiDeleteService,
  type PricelistSection,
  type PricelistSectionRow,
  type PricelistService,
} from '@/lib/pricelist-api'
import { servicePriceForClass } from '@detailing-admin/shared'
import type { CarClass } from '@detailing-admin/shared'
import { useInvalidatePricelist, usePricelistQuery } from '@/lib/queries'
import SectionFormDialog from './SectionFormDialog.vue'
import ServiceFormDialog from './ServiceFormDialog.vue'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

// Таблица прайса — семь колонок и почти тысяча пикселей ширины, поэтому ниже
// 640px услуги показываются карточками. Данные и диалоги у раскладок общие.
const isWideScreen = useMediaQuery('(min-width: 640px)')

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
const deleteError = ref<string | null>(null)

const totalServices = computed(() =>
  sections.value.reduce((acc, s) => acc + s.services.length, 0),
)

const CLASS_COLUMNS: readonly CarClass[] = [1, 2, 3, 4]
const CLASS_NUMERALS: Record<CarClass, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

function classLabel(cls: CarClass): string {
  return `${CLASS_NUMERALS[cls]} кл.`
}

const priceFormatter = new Intl.NumberFormat('ru-RU')

function formatClassPrice(svc: PricelistService, cls: CarClass): string {
  const { min, max } = servicePriceForClass(svc, cls)
  if (max === null) return `${priceFormatter.format(min)} ₽`
  return `${priceFormatter.format(min)} – ${priceFormatter.format(max)} ₽`
}

// Соседние классы с одинаковой ценой сливаются в одну строку: почти треть услуг
// стоит одинаково во всех четырёх классах, ещё у трети совпадают I–II и III–IV,
// и в карточке сетка из четырёх одинаковых чисел только мешает читать.
// Сравниваем готовые строки — одинаковая пара min/max даёт одинаковый текст.
function priceGroups(svc: PricelistService): { label: string; price: string }[] {
  const groups: { classes: CarClass[]; price: string }[] = []
  for (const cls of CLASS_COLUMNS) {
    const price = formatClassPrice(svc, cls)
    const last = groups[groups.length - 1]
    if (last && last.price === price) last.classes.push(cls)
    else groups.push({ classes: [cls], price })
  }
  return groups.map(({ classes, price }) => {
    const first = classes[0]
    const last = classes[classes.length - 1]
    if (classes.length === CLASS_COLUMNS.length) return { label: 'Все классы', price }
    const label =
      classes.length === 1
        ? classLabel(first)
        : `${CLASS_NUMERALS[first]}–${CLASS_NUMERALS[last]} кл.`
    return { label, price }
  })
}

// Девять разделов и почти сотня услуг — на телефоне это бесконечная лента,
// поэтому в компактной раскладке разделы свёрнуты и работают как оглавление.
// На широком экране состояние не используется: таблица всегда развёрнута.
const openSections = ref<Set<number>>(new Set())

function toggleSection(sectionId: number) {
  const next = new Set(openSections.value)
  if (next.has(sectionId)) next.delete(sectionId)
  else next.add(sectionId)
  openSections.value = next
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
  // Иначе в компактной раскладке новая услуга уедет в свёрнутый раздел и
  // сохранение будет выглядеть как «ничего не произошло».
  if (defaultSectionId != null && !openSections.value.has(defaultSectionId)) {
    toggleSection(defaultSectionId)
  }
}

function openEditService(svc: PricelistService) {
  serviceEditing.value = svc
  serviceDefaultSectionId.value = svc.sectionId
  serviceDialogOpen.value = true
}

function askDeleteSection(section: PricelistSection) {
  deleteTarget.value = { kind: 'section', id: section.id, name: section.name }
  deleteError.value = null
  deleteDialogOpen.value = true
}

function askDeleteService(svc: PricelistService) {
  deleteTarget.value = { kind: 'service', id: svc.id, name: svc.name }
  deleteError.value = null
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
  if (!target || deleting.value) return
  deleteError.value = null
  deleting.value = true
  try {
    const result =
      target.kind === 'section'
        ? await apiDeleteSection(target.id)
        : await apiDeleteService(target.id)

    if (result.ok) {
      toast.success(target.kind === 'section' ? 'Раздел удалён' : 'Услуга удалена')
      deleteDialogOpen.value = false
      await invalidatePricelist()
      return
    }

    if (result.error === 'not_found') {
      // Already gone — the outcome the user wanted; close and refresh.
      toast.error('Запись уже удалена')
      deleteDialogOpen.value = false
      await invalidatePricelist()
      return
    }

    // Real failure — keep the dialog open and surface the reason inside it.
    if (result.error === 'conflict' && result.reason === 'has_services') {
      deleteError.value = 'Сначала удалите услуги из раздела'
    } else if (result.error === 'unavailable') {
      deleteError.value = result.message
    } else {
      deleteError.value = 'Не удалось удалить'
    }
  } catch {
    deleteError.value = 'Не удалось удалить'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-2 sm:p-8">
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

      <div v-else-if="isWideScreen" class="overflow-hidden rounded-md border border-border">
        <Table>
          <colgroup>
            <col class="w-72" />
            <col v-for="c in CLASS_COLUMNS" :key="c" class="w-36" />
            <col class="w-16 md:w-auto" />
            <col class="w-24" />
          </colgroup>
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="px-4">Услуга</TableHead>
              <TableHead v-for="c in CLASS_COLUMNS" :key="c" class="px-4 text-right">
                {{ classLabel(c) }}
              </TableHead>
              <TableHead class="px-4 text-center md:text-left">
                <span class="hidden md:inline">Примечание</span>
                <span class="md:hidden">Прим.</span>
              </TableHead>
              <TableHead class="px-4 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 6" :key="i">
                <TableCell class="px-4"><Skeleton class="h-4 w-48" /></TableCell>
                <TableCell v-for="c in CLASS_COLUMNS" :key="c" class="px-4 text-right">
                  <Skeleton class="h-4 w-24 ml-auto" />
                </TableCell>
                <TableCell class="px-4"><Skeleton class="h-4 w-8 md:w-40" /></TableCell>
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
                <TableCell class="px-4 font-medium whitespace-normal">
                  {{ svc.name }}
                  <Badge
                    v-if="svc.countable"
                    variant="secondary"
                    class="ml-1.5 align-middle font-normal tabular-nums"
                    title="Можно указать количество в записи"
                  >
                    ×N
                  </Badge>
                </TableCell>
                <TableCell
                  v-for="c in CLASS_COLUMNS"
                  :key="c"
                  class="px-4 text-right tabular-nums whitespace-nowrap"
                >
                  {{ formatClassPrice(svc, c) }}
                </TableCell>
                <TableCell class="px-4 text-xs text-muted-foreground whitespace-pre-line">
                  <span class="hidden md:inline">{{ svc.description || '' }}</span>
                  <div class="flex justify-center md:hidden">
                    <Popover v-if="svc.description">
                      <PopoverTrigger as-child>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          :aria-label="`Примечание к услуге ${svc.name}`"
                        >
                          <Info class="size-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="center"
                        class="w-64 text-xs text-muted-foreground whitespace-pre-line"
                      >
                        {{ svc.description }}
                      </PopoverContent>
                    </Popover>
                  </div>
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

      <!-- Компактная раскладка: раздел — сворачиваемая группа, услуга — карточка
           с ценами по классам сеткой 2×2 под названием. Примечание остаётся под
           кнопкой: у большинства услуг это несколько строк текста. -->
      <div v-else class="overflow-hidden rounded-md border border-border">
        <template v-if="loading">
          <div
            v-for="i in 6"
            :key="i"
            class="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
          >
            <Skeleton class="h-4 flex-1" />
            <Skeleton class="h-4 w-16" />
          </div>
        </template>

        <p v-else-if="sections.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground">
          Прайс-лист пуст.
        </p>

        <div
          v-else
          v-for="section in sections"
          :key="section.id"
          class="border-b border-border last:border-b-0"
        >
          <div class="flex items-center gap-1 bg-muted/50 py-1.5 pr-1 pl-2">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
              :aria-expanded="openSections.has(section.id)"
              @click="toggleSection(section.id)"
            >
              <ChevronRight
                class="size-4 shrink-0 text-muted-foreground transition-transform"
                :class="{ 'rotate-90': openSections.has(section.id) }"
              />
              <span class="min-w-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ section.name }}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
                {{ section.services.length }}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Добавить услугу в раздел ${section.name}`"
              @click="openCreateService(section.id)"
            >
              <Plus class="size-3.5" />
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

          <template v-if="openSections.has(section.id)">
            <p
              v-if="section.services.length === 0"
              class="border-t border-border px-3 py-3 text-sm text-muted-foreground"
            >
              В разделе нет услуг
            </p>
            <div
              v-for="svc in section.services"
              :key="svc.id"
              class="border-t border-border px-3 py-2.5"
            >
              <div class="flex items-start gap-1">
                <div class="min-w-0 flex-1 pt-1 font-medium">
                  {{ svc.name }}
                  <Badge
                    v-if="svc.countable"
                    variant="secondary"
                    class="ml-1.5 align-middle font-normal tabular-nums"
                    title="Можно указать количество в записи"
                  >
                    ×N
                  </Badge>
                </div>
                <div class="inline-flex shrink-0">
                  <Popover v-if="svc.description">
                    <PopoverTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        :aria-label="`Примечание к услуге ${svc.name}`"
                      >
                        <Info class="size-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      class="w-72 text-xs text-muted-foreground whitespace-pre-line"
                    >
                      {{ svc.description }}
                    </PopoverContent>
                  </Popover>
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
              </div>

              <!-- Одна цена на все классы занимает строку целиком, две и больше
                   встают в две колонки. -->
              <div
                class="mt-1 grid gap-x-4"
                :class="priceGroups(svc).length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
              >
                <div
                  v-for="group in priceGroups(svc)"
                  :key="group.label"
                  class="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span class="text-xs text-muted-foreground">{{ group.label }}</span>
                  <span class="tabular-nums">{{ group.price }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
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
