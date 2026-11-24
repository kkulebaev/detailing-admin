<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, Copy, Layers, Plus, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { Master } from '@/lib/masters-api'
import type { PricelistSection } from '@/lib/pricelist-api'
import { saveMasterWorkRules, type WorkRule } from '@/lib/work-rules-api'
import {
  CLASS_LABELS,
  describeTarget,
  emptyDraft,
  parseDrafts,
  ruleToDraft,
  sortByPricelist,
  targetKey,
  type WorkRuleDraft,
} from '@/lib/work-rules'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const props = defineProps<{
  open: boolean
  master: Master | null
  rules: WorkRule[]
  sections: PricelistSection[]
  // Другие мастера с непустыми правилами — откуда можно скопировать набор.
  copySources: { id: number; name: string; rules: WorkRule[] }[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

const drafts = ref<WorkRuleDraft[]>([])
const errors = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const submitting = ref(false)
const pickerOpen = ref(false)
const copiedFrom = ref<string | null>(null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    drafts.value = props.rules.map(ruleToDraft)
    errors.value = {}
    formError.value = null
    copiedFrom.value = null
  },
)

// Копия заменяет черновик целиком и сохраняется только по «Сохранить», поэтому
// «Отмена» возвращает правила мастера как были.
function copyFrom(source: { name: string; rules: WorkRule[] }) {
  drafts.value = source.rules.map(ruleToDraft)
  errors.value = {}
  formError.value = null
  copiedFrom.value = source.name
}

const sorted = computed(() => sortByPricelist(drafts.value, props.sections))
const usedKeys = computed(() => new Set(drafts.value.map((d) => d.key)))

function info(d: WorkRuleDraft) {
  return describeTarget(d, props.sections)
}

function add(target: { sectionId: number | null; serviceId: number | null }) {
  if (usedKeys.value.has(targetKey(target))) return
  drafts.value = [...drafts.value, emptyDraft(target)]
  pickerOpen.value = false
}

function remove(key: string) {
  drafts.value = drafts.value.filter((d) => d.key !== key)
  delete errors.value[key]
}

// reka-ui сбрасывает ToggleGroup с одиночным выбором при повторном клике по
// активному пункту — пустое значение игнорируем, чтобы тип оплаты не пропал.
function onKindChange(d: WorkRuleDraft, v: unknown) {
  if (v === 'percent' || v === 'fixed') d.kind = v
}

function digitsOnly(e: Event, max: number): string {
  const el = e.target
  if (!(el instanceof HTMLInputElement)) return ''
  const v = el.value.replace(/\D/g, '').slice(0, max)
  if (el.value !== v) el.value = v
  return v
}

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  const master = props.master
  if (!master || submitting.value) return
  errors.value = {}
  formError.value = null

  const order = sorted.value
  const parsed = parseDrafts(order)
  if (!parsed.ok) {
    errors.value = parsed.errors
    formError.value = 'Исправьте отмеченные поля'
    // Правил может быть больше, чем помещается в диалог: без прокрутки ошибка остается за экраном.
    await nextTick()
    document.querySelector('[data-rule-invalid]')?.scrollIntoView({ block: 'center' })
    return
  }

  submitting.value = true
  try {
    const result = await saveMasterWorkRules(master.id, parsed.rules)
    if (result.ok) {
      toast.success('Виды работ сохранены')
      emit('saved')
      emit('update:open', false)
      return
    }
    if (result.error === 'validation') {
      // Путь ошибки — ['rules', индекс, поле]; индекс указывает на порядок отправки.
      const mapped: Record<string, string> = {}
      for (const issue of result.issues) {
        const i = issue.path[1]
        const d = typeof i === 'number' ? order[i] : undefined
        if (d) mapped[d.key] = issue.message
      }
      errors.value = mapped
      formError.value = result.issues[0]?.message ?? 'Неверные данные'
    } else if (result.error === 'not_found') {
      formError.value = 'Мастер не найден, возможно, его удалили'
    } else if (result.error === 'unavailable') {
      formError.value = result.message
    } else {
      formError.value = 'Не удалось сохранить виды работ'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-h-svh overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ master?.name }}</DialogTitle>
        <DialogDescription>
          Виды работ и оплата за них: % от цены услуги или ₽ за единицу по классу кузова. Правило
          для услуги важнее правила ее раздела.
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-3 py-2" @submit.prevent="submit">
        <p
          v-if="sorted.length === 0"
          class="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
        >
          Видов работ пока нет. Добавьте раздел прайса или отдельную услугу.
        </p>

        <div
          v-for="d in sorted"
          :key="d.key"
          role="group"
          :aria-label="info(d).title"
          :data-rule-invalid="errors[d.key] ? '' : undefined"
          :class="[
            'grid min-w-0 gap-2 rounded-md border px-3 py-2.5',
            errors[d.key] ? 'border-destructive' : 'border-border',
          ]"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium break-words">{{ info(d).title }}</p>
              <p class="text-xs text-muted-foreground">{{ info(d).subtitle }}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              class="-mt-1 -mr-2 shrink-0"
              :disabled="submitting"
              :aria-label="`Убрать ${info(d).title}`"
              @click="remove(d.key)"
            >
              <X class="size-3.5" />
            </Button>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              class="shrink-0"
              :model-value="d.kind"
              :disabled="submitting"
              @update:model-value="(v) => onKindChange(d, v)"
            >
              <ToggleGroupItem
                value="percent"
                class="h-10 min-w-12"
                :aria-label="`Процент: ${info(d).title}`"
              >
                %
              </ToggleGroupItem>
              <ToggleGroupItem
                value="fixed"
                class="h-10 min-w-12"
                :aria-label="`Фикс: ${info(d).title}`"
              >
                ₽
              </ToggleGroupItem>
            </ToggleGroup>

            <div v-if="d.kind === 'percent'" class="relative">
              <Input
                type="text"
                inputmode="numeric"
                autocomplete="off"
                class="h-10 w-24 pr-7 text-right tabular-nums"
                placeholder="0"
                :aria-label="`Процент для ${info(d).title}`"
                :aria-invalid="errors[d.key] ? true : undefined"
                :model-value="d.percent"
                :disabled="submitting"
                @input="d.percent = digitsOnly($event, 3)"
              />
              <span
                class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                >%</span
              >
            </div>
          </div>

          <div v-if="d.kind === 'fixed'" class="grid w-full grid-cols-4 gap-2">
            <label v-for="(label, ci) in CLASS_LABELS" :key="label" class="grid gap-1 text-center">
              <span class="text-xs text-muted-foreground">{{ label }} класс</span>
              <Input
                type="text"
                inputmode="numeric"
                autocomplete="off"
                class="h-10 px-1.5 text-right tabular-nums"
                placeholder="₽"
                :aria-label="`Фикс ${label} класс для ${info(d).title}`"
                :aria-invalid="errors[d.key] ? true : undefined"
                :model-value="d.fixed[ci]"
                :disabled="submitting"
                @input="d.fixed[ci] = digitsOnly($event, 8)"
              />
            </label>
          </div>
          <p v-if="errors[d.key]" class="text-sm text-destructive" role="alert">
            {{ errors[d.key] }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <Popover v-model:open="pickerOpen">
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="outline"
                class="flex-1 justify-start"
                :disabled="submitting || sections.length === 0"
              >
                <Plus class="size-4" /> Раздел или услуга
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start">
              <Command>
                <CommandInput placeholder="Найти раздел или услугу…" />
                <CommandList>
                  <CommandEmpty>Ничего не найдено</CommandEmpty>
                  <CommandGroup v-for="sec in sections" :key="sec.id" :heading="sec.name">
                    <CommandItem
                      :value="`section:${sec.id}`"
                      :keywords="[sec.name]"
                      :disabled="usedKeys.has(`section:${sec.id}`)"
                      @select="add({ sectionId: sec.id, serviceId: null })"
                    >
                      <Layers class="text-muted-foreground" />
                      <span class="font-medium">Весь раздел</span>
                      <Check v-if="usedKeys.has(`section:${sec.id}`)" class="ml-auto" />
                    </CommandItem>
                    <CommandItem
                      v-for="svc in sec.services"
                      :key="svc.id"
                      :value="`service:${svc.id}`"
                      :keywords="[svc.name, sec.name]"
                      :disabled="usedKeys.has(`service:${svc.id}`)"
                      @select="add({ sectionId: null, serviceId: svc.id })"
                    >
                      <span class="pl-6">{{ svc.name }}</span>
                      <Check v-if="usedKeys.has(`service:${svc.id}`)" class="ml-auto" />
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <DropdownMenu v-if="copySources.length > 0">
            <DropdownMenuTrigger as-child>
              <Button type="button" variant="outline" :disabled="submitting">
                <Copy class="size-4" /> Скопировать у мастера
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
                Заменит текущий список
              </DropdownMenuLabel>
              <DropdownMenuItem v-for="s in copySources" :key="s.id" @select="copyFrom(s)">
                <span class="flex-1">{{ s.name }}</span>
                <span class="text-xs tabular-nums text-muted-foreground">{{ s.rules.length }}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p v-if="copiedFrom" class="text-xs text-muted-foreground" role="status">
          Скопировано у мастера {{ copiedFrom }}. Проверьте и нажмите «Сохранить».
        </p>

        <p v-if="sections.length === 0" class="text-xs text-muted-foreground">
          Прайс пуст или еще загружается, добавить работы пока нельзя.
        </p>

        <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>

        <DialogFooter class="gap-2">
          <Button type="button" variant="ghost" :disabled="submitting" @click="close">
            Отмена
          </Button>
          <Button type="submit" :disabled="submitting">
            {{ submitting ? 'Сохранение…' : 'Сохранить' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
