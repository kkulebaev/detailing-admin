<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Check, ChevronsUpDown, X } from '@lucide/vue'
import {
  fetchPricelist,
  type PricelistSection,
  type PricelistService,
} from '@/lib/pricelist-api'
import type { CarClass } from '@detailing-admin/shared'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    carClass: CarClass
    invalid?: boolean
  }>(),
  { modelValue: '', invalid: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:carClass': [value: CarClass]
}>()

const CLASS_OPTIONS: readonly CarClass[] = [1, 2, 3, 4] as const
const ROMAN: Record<CarClass, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

const sections = ref<PricelistSection[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const open = ref(false)

const serviceById = computed(() => {
  const m = new Map<number, PricelistService>()
  for (const sec of sections.value) for (const svc of sec.services) m.set(svc.id, svc)
  return m
})

// Selected service ids — ListboxRoot in multiple mode binds an array.
const selectedIds = ref<number[]>([])

function priceOf(svc: PricelistService, cls: CarClass): number {
  if (cls === 1) return svc.priceClass1
  if (cls === 2) return svc.priceClass2
  if (cls === 3) return svc.priceClass3
  return svc.priceClass4
}

const priceFormatter = new Intl.NumberFormat('ru-RU')
function formatPrice(n: number): string {
  return `${priceFormatter.format(n)} ₽`
}

// Canonical CSV of selected names, ordered by section order in the pricelist.
function selectionToCsv(): string {
  const idSet = new Set(selectedIds.value)
  const names: string[] = []
  for (const sec of sections.value) {
    for (const svc of sec.services) {
      if (idSet.has(svc.id)) names.push(svc.name)
    }
  }
  return names.join(', ')
}

function emitModelValue() {
  const next = selectionToCsv()
  if (next !== props.modelValue) emit('update:modelValue', next)
}

// Re-derive selection from the parent's CSV (e.g. draft restore or clearForm).
// Unmatched names are dropped — we then push the canonical CSV back so the form
// value reflects what's actually selectable.
function syncSelectionFromString() {
  if (sections.value.length === 0) return
  const csv = (props.modelValue ?? '').trim()
  const names = csv ? csv.split(',').map((s) => s.trim()).filter(Boolean) : []
  const nameToId = new Map<string, number>()
  for (const sec of sections.value) for (const svc of sec.services) nameToId.set(svc.name, svc.id)
  const next: number[] = []
  for (const n of names) {
    const id = nameToId.get(n)
    if (id != null) next.push(id)
  }
  const same =
    next.length === selectedIds.value.length &&
    next.every((id, i) => selectedIds.value[i] === id)
  if (!same) selectedIds.value = next
  emitModelValue()
}

// Reka-UI ListboxRoot stores the original `value` type for each item, so in
// multi-mode this comes back as `number[]`. Guard at runtime in case the
// upstream contract ever changes (e.g. values stringified).
function onSelectionChange(next: unknown) {
  selectedIds.value = Array.isArray(next)
    ? next.filter((x): x is number => typeof x === 'number')
    : []
  emitModelValue()
}

function removeId(id: number) {
  const next = selectedIds.value.filter((x) => x !== id)
  if (next.length === selectedIds.value.length) return
  selectedIds.value = next
  emitModelValue()
}

const totalEstimate = computed(() => {
  let sum = 0
  for (const id of selectedIds.value) {
    const svc = serviceById.value.get(id)
    if (svc) sum += priceOf(svc, props.carClass)
  }
  return sum
})

interface SelectedRow {
  id: number
  name: string
  price: number
}
const selectedList = computed<SelectedRow[]>(() => {
  const idSet = new Set(selectedIds.value)
  const list: SelectedRow[] = []
  for (const sec of sections.value) {
    for (const svc of sec.services) {
      if (idSet.has(svc.id)) {
        list.push({ id: svc.id, name: svc.name, price: priceOf(svc, props.carClass) })
      }
    }
  }
  return list
})

const triggerLabel = computed(() => {
  const n = selectedIds.value.length
  if (n === 0) return 'Выбрать услугу'
  return `Выбрано ${n} ${pluralize(n, ['услуга', 'услуги', 'услуг'])}`
})

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  const n1 = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

onMounted(async () => {
  try {
    const res = await fetchPricelist()
    if (res.ok) {
      sections.value = res.sections
      syncSelectionFromString()
    } else if (res.error === 'unavailable') {
      loadError.value = res.message || 'Прайс-лист недоступен'
    } else {
      loadError.value = 'Не удалось загрузить прайс-лист'
    }
  } catch {
    loadError.value = 'Сетевая ошибка при загрузке прайс-листа'
  } finally {
    loading.value = false
  }
})

watch(() => props.modelValue, syncSelectionFromString)
</script>

<template>
  <div>
    <!-- Class switcher -->
    <div class="flex flex-wrap items-center gap-2 mb-2">
      <span class="text-xs text-muted-foreground">Класс кузова</span>
      <div class="inline-flex rounded-md border border-input p-0.5 bg-background">
        <button
          v-for="c in CLASS_OPTIONS"
          :key="c"
          type="button"
          :data-active="props.carClass === c"
          class="text-xs px-3 py-1 rounded-sm transition-colors hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
          @click="emit('update:carClass', c)"
        >
          {{ ROMAN[c] }}
        </button>
      </div>
    </div>

    <!-- Combobox trigger + popover -->
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          :aria-expanded="open"
          :aria-invalid="props.invalid"
          :disabled="loading || !!loadError"
          class="w-full h-11 justify-between font-normal text-left"
        >
          <span :class="selectedIds.length === 0 ? 'text-muted-foreground' : ''">
            {{ loading ? 'Загрузка прайс-листа…' : triggerLabel }}
          </span>
          <ChevronsUpDown class="size-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        class="w-(--reka-popover-trigger-width) p-0"
        align="start"
        :side-offset="4"
      >
        <Command
          multiple
          :model-value="selectedIds"
          @update:model-value="onSelectionChange"
        >
          <CommandInput placeholder="Найти услугу…" />
          <CommandList>
            <CommandEmpty>
              Услуга не найдена. Добавьте её в
              <router-link to="/pricelist" class="underline">прайс-лист</router-link>.
            </CommandEmpty>
            <CommandGroup
              v-for="sec in sections"
              :key="sec.id"
              :heading="sec.name"
            >
              <CommandItem
                v-for="svc in sec.services"
                :key="svc.id"
                :value="svc.id"
                :keywords="[svc.name, svc.description ?? '']"
              >
                <Check
                  :class="selectedIds.includes(svc.id) ? 'opacity-100' : 'opacity-0'"
                />
                <span class="flex-1">{{ svc.name }}</span>
                <span class="tabular-nums text-muted-foreground">
                  {{ formatPrice(priceOf(svc, props.carClass)) }}
                </span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>

    <p v-if="loadError" class="text-sm text-destructive mt-2">
      {{ loadError }} —
      <router-link to="/pricelist" class="underline">открыть прайс-лист</router-link>
    </p>

    <!-- Selected chips -->
    <div v-if="selectedList.length" class="flex flex-wrap gap-1.5 mt-3">
      <button
        v-for="s in selectedList"
        :key="s.id"
        type="button"
        class="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors"
        :aria-label="`Удалить услугу ${s.name}`"
        @click="removeId(s.id)"
      >
        <span>{{ s.name }}</span>
        <span class="opacity-80 tabular-nums">{{ formatPrice(s.price) }}</span>
        <X class="size-3" />
      </button>
    </div>

    <p v-if="selectedList.length" class="text-xs text-muted-foreground mt-2">
      Ориентировочно ≈ {{ formatPrice(totalEstimate) }}
    </p>
  </div>
</template>
