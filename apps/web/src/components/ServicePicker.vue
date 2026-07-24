<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronsUpDown, Minus, Plus, X } from '@lucide/vue'
import {
  type PricelistSection,
  type PricelistService,
} from '@/lib/pricelist-api'
import { usePricelistQuery } from '@/lib/queries'
import { maskThousands } from '@/lib/number-mask'
import type { ServiceBreakdownRow } from '@/lib/service-breakdown'
import { servicePriceForClass } from '@detailing-admin/shared'
import type { CarClass } from '@detailing-admin/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  // Sum of the per-service editable prices; null when nothing is selected.
  // Emitted only from user actions (select/remove/price edit/class switch) —
  // NOT from draft-restore sync, so a drafted manual amount survives reload.
  'update:total': [value: number | null]
  // Per-service breakdown (section + name + current price) for the sheet's
  // «Услуга» cell. Unlike total, this fires on every change including restore —
  // it doesn't feed back into any field, so there's no draft conflict.
  'update:breakdown': [value: ServiceBreakdownRow[]]
}>()

const CLASS_OPTIONS: readonly CarClass[] = [1, 2, 3, 4] as const
const ROMAN: Record<CarClass, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }

// Pricelist is shared cache: this query and PricelistPage's both read from the
// same key, so opening /pricelist after the form (or vice versa) is instant.
const { data: queryData, error: queryError, asyncStatus } = usePricelistQuery()

const sections = computed<PricelistSection[]>(() => {
  const r = queryData.value
  return r?.ok ? r.sections : []
})

const loading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined,
)

const loadError = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке прайс-листа'
  const r = queryData.value
  if (!r || r.ok) return null
  if (r.error === 'unavailable') return r.message || 'Прайс-лист недоступен'
  return 'Не удалось загрузить прайс-лист'
})

const open = ref(false)

// Selected service ids — ListboxRoot in multiple mode binds an array.
const selectedIds = ref<number[]>([])

const serviceById = computed(() => {
  const m = new Map<number, PricelistService>()
  for (const sec of sections.value) for (const svc of sec.services) m.set(svc.id, svc)
  return m
})

const priceFormatter = new Intl.NumberFormat('ru-RU')
function formatServicePrice(svc: PricelistService): string {
  const { min, max } = servicePriceForClass(svc, props.carClass)
  if (max === null) return `${priceFormatter.format(min)} ₽`
  return `${priceFormatter.format(min)} – ${priceFormatter.format(max)} ₽`
}

// ── Editable per-service prices ──────────────────────────────────────────────
// Keyed by service id; values are the masked input strings («12 000»).
// Default is the class price (lower bound for ranges).
const rawPrices = ref<Record<number, string>>({})

// Per-service quantity, keyed by service id. Only «штучные» (countable)
// services expose a stepper; every entry defaults to 1 and the line total is
// unit price × quantity.
const quantities = ref<Record<number, number>>({})
const MAX_QTY = 99

function qtyFor(id: number): number {
  return quantities.value[id] ?? 1
}

function setQty(id: number, qty: number) {
  const clamped = Math.min(MAX_QTY, Math.max(1, qty))
  quantities.value = { ...quantities.value, [id]: clamped }
  emitTotal()
}
function incQty(id: number) {
  setQty(id, qtyFor(id) + 1)
}
function decQty(id: number) {
  setQty(id, qtyFor(id) - 1)
}

// Line total (unit price × quantity) for a selected service — drives both the
// «N × цена = сумма» hint and the emitted total.
function lineTotal(id: number): number {
  const unit = parseInt(priceDigits(rawPrices.value[id] ?? ''), 10) || 0
  return unit * qtyFor(id)
}

function formatDigits(digits: string): string {
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function priceDigits(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

function defaultPriceFor(id: number): string {
  const svc = serviceById.value.get(id)
  if (!svc) return ''
  return formatDigits(String(servicePriceForClass(svc, props.carClass).min))
}

// Align price state with the current selection: newly picked services get the
// class default, deselected ones are dropped. `resetAll` re-derives every
// price (used when the car class changes — manual edits belong to the old
// class's tariff and would be misleading to keep).
function syncPricesToSelection(resetAll = false) {
  const next: Record<number, string> = {}
  const nextQty: Record<number, number> = {}
  for (const id of selectedIds.value) {
    const kept = rawPrices.value[id]
    next[id] = !resetAll && kept !== undefined ? kept : defaultPriceFor(id)
    // Quantity is independent of the car class tariff — keep it across a class
    // switch (resetAll) and only drop entries for deselected services.
    nextQty[id] = quantities.value[id] ?? 1
  }
  rawPrices.value = next
  quantities.value = nextQty
}

const total = computed(() =>
  selectedIds.value.reduce((acc, id) => acc + lineTotal(id), 0),
)

function emitTotal() {
  emit('update:total', selectedIds.value.length === 0 ? null : total.value)
}

function onPriceInput(id: number, e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  const caretPos = target.selectionStart ?? target.value.length
  const { value, caret } = maskThousands(target.value, caretPos, 8)
  if (target.value !== value) {
    target.value = value
    target.setSelectionRange(caret, caret)
  }
  rawPrices.value = { ...rawPrices.value, [id]: value }
  emitTotal()
}

watch(
  () => props.carClass,
  () => {
    if (selectedIds.value.length === 0) return
    syncPricesToSelection(true)
    emitTotal()
  },
)

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
  // The parent echoes our own name-only CSV back through `modelValue`. That CSV
  // can't tell apart two services sharing a name (e.g. «Крыша» exists in both
  // «Полировка» and «Шумоизоляция»), so re-resolving an echo would silently swap
  // the picked copy for another section's — and skip the total re-emit, leaving
  // «Сумма» stale. If the CSV already matches the current selection, keep the
  // ids (and prices) we have.
  if (csv === selectionToCsv()) return
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
  if (same) return
  selectedIds.value = next
  syncPricesToSelection()
  emitModelValue()
}

// Reka-UI ListboxRoot stores the original `value` type for each item, so in
// multi-mode this comes back as `number[]`. Guard at runtime in case the
// upstream contract ever changes (e.g. values stringified).
function onSelectionChange(next: unknown) {
  selectedIds.value = Array.isArray(next)
    ? next.filter((x): x is number => typeof x === 'number')
    : []
  syncPricesToSelection()
  emitModelValue()
  emitTotal()
}

function removeId(id: number) {
  const next = selectedIds.value.filter((x) => x !== id)
  if (next.length === selectedIds.value.length) return
  selectedIds.value = next
  syncPricesToSelection()
  emitModelValue()
  emitTotal()
}

interface SelectedRow {
  id: number
  name: string
  countable: boolean
}
interface SelectedGroup {
  sectionId: number
  section: string
  rows: SelectedRow[]
}
// Selected services grouped under their section heading — some service names
// (e.g. «Крыша», «Капот») exist in more than one section, so the category is
// what disambiguates them in the picked list.
const selectedGroups = computed<SelectedGroup[]>(() => {
  const idSet = new Set(selectedIds.value)
  const groups: SelectedGroup[] = []
  for (const sec of sections.value) {
    const rows = sec.services
      .filter((svc) => idSet.has(svc.id))
      .map((svc) => ({ id: svc.id, name: svc.name, countable: svc.countable }))
    if (rows.length) groups.push({ sectionId: sec.id, section: sec.name, rows })
  }
  return groups
})

// Flat, ordered breakdown for the sheet cell — carries the current (edited)
// price of each selected service. Re-emitted whenever it changes.
const selectedBreakdown = computed<ServiceBreakdownRow[]>(() => {
  const idSet = new Set(selectedIds.value)
  const rows: ServiceBreakdownRow[] = []
  for (const sec of sections.value) {
    for (const svc of sec.services) {
      if (!idSet.has(svc.id)) continue
      const digits = (rawPrices.value[svc.id] ?? '').replace(/\D/g, '')
      rows.push({
        sectionId: sec.id,
        section: sec.name,
        name: svc.name,
        price: digits === '' ? 0 : parseInt(digits, 10),
        quantity: qtyFor(svc.id),
      })
    }
  }
  return rows
})
watch(selectedBreakdown, (rows) => emit('update:breakdown', rows))

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

// Drive selection-sync off `sections` instead of `onMounted`: when the
// pricelist is already in cache it's available synchronously and we can
// project the parent's CSV → ids on the first render. Cache miss → fires
// once data arrives.
//
// Why a one-shot guard: Colada refetches on focus by default, and each
// refetch produces a fresh `sections` reference. Without the guard, every
// refocus would re-project the parent's (potentially stale) CSV back into
// `selectedIds`, racing with any local edits the user just made.
let synced = false
watch(
  sections,
  () => {
    if (synced || sections.value.length === 0) return
    synced = true
    syncSelectionFromString()
  },
  { immediate: true },
)
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
                <span class="tabular-nums text-muted-foreground whitespace-nowrap">
                  {{ formatServicePrice(svc) }}
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

    <!-- Selected services with editable prices.
         @input.stop / @change.stop: if a parent ever binds vee-validate's
         componentField on this component, its fallthrough `onInput`/`onChange`
         DOM listeners on the root div would catch the events bubbling from the
         price fields (input while typing, change on blur) and overwrite the
         `service` form value with the typed price. -->
    <div v-if="selectedIds.length" class="mt-3 space-y-3" @input.stop @change.stop>
      <fieldset
        v-for="group in selectedGroups"
        :key="group.sectionId"
        class="min-w-0 rounded-lg border border-border px-0 pb-1"
      >
        <legend class="ml-2 px-1.5 text-xs font-medium text-muted-foreground">
          {{ group.section }}
        </legend>
        <div>
          <div v-for="s in group.rows" :key="s.id" class="px-3 py-2">
            <!-- Всё в один ряд: название (сжимается и переносится) + счётчик +
                 цена + удаление. Контролы облегчены, чтобы уместиться на 375px. -->
            <div class="flex items-center gap-1.5">
              <!-- line-clamp-2 + break-words: длинные названия штучных услуг
                   (напр. «Ремни безопасности 1 шт.») в узкой колонке рядом со
                   счётчиком не влезают — обрезаем до 2 строк с многоточием,
                   полное название доступно в title. -->
              <span
                class="flex-1 min-w-0 text-xs leading-tight line-clamp-2 break-words"
                :title="s.name"
                >{{ s.name }}</span
              >
              <!-- Штучная услуга: счётчик количества. Цена в поле справа — за единицу. -->
              <div
                v-if="s.countable"
                class="inline-flex h-8 shrink-0 items-center rounded-md border border-input"
              >
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-l-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  :aria-label="`Уменьшить количество ${s.name}`"
                  :disabled="qtyFor(s.id) <= 1"
                  @click="decQty(s.id)"
                >
                  <Minus class="size-3.5" />
                </button>
                <span class="w-5 text-center text-sm tabular-nums">{{ qtyFor(s.id) }}</span>
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  :aria-label="`Увеличить количество ${s.name}`"
                  :disabled="qtyFor(s.id) >= MAX_QTY"
                  @click="incQty(s.id)"
                >
                  <Plus class="size-3.5" />
                </button>
              </div>
              <div class="relative shrink-0">
                <Input
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  class="h-8 w-20 pr-4 text-right text-sm tabular-nums"
                  :aria-label="`Цена услуги ${s.name}`"
                  :model-value="rawPrices[s.id] ?? ''"
                  @input="(e: Event) => onPriceInput(s.id, e)"
                />
                <span class="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₽</span>
              </div>
              <button
                type="button"
                class="shrink-0 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                :aria-label="`Удалить услугу ${s.name}`"
                @click="removeId(s.id)"
              >
                <X class="size-3.5" />
              </button>
            </div>
            <p
              v-if="s.countable && qtyFor(s.id) > 1"
              class="mt-1 pr-8 text-right text-xs text-muted-foreground tabular-nums"
            >
              {{ qtyFor(s.id) }} × {{ rawPrices[s.id] || '0' }} ₽ =
              {{ formatDigits(String(lineTotal(s.id))) }} ₽
            </p>
          </div>
        </div>
      </fieldset>
    </div>
  </div>
</template>
