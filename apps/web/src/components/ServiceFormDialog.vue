<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { servicePriceForClass } from '@detailing-admin/shared'
import {
  createService,
  updateService,
  type PricelistSection,
  type PricelistService,
} from '@/lib/pricelist-api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  open: boolean
  service: PricelistService | null
  defaultSectionId: number | null
  sections: PricelistSection[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

const isEdit = computed(() => props.service !== null)

const ROMAN = ['I', 'II', 'III', 'IV'] as const

interface ClassPriceRaw {
  min: string
  max: string
}
function emptyClassPrices(): ClassPriceRaw[] {
  return ROMAN.map(() => ({ min: '', max: '' }))
}

const sectionId = ref<string>('')
const name = ref('')
const description = ref('')
const countable = ref(false)
const classPrices = ref<ClassPriceRaw[]>(emptyClassPrices())

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

watch(
  () => props.open,
  (v) => {
    if (!v) return
    if (props.service) {
      const s = props.service
      sectionId.value = String(s.sectionId)
      name.value = s.name
      description.value = s.description ?? ''
      countable.value = s.countable
      classPrices.value = ([1, 2, 3, 4] as const).map((cls) => {
        const { min, max } = servicePriceForClass(s, cls)
        return { min: String(min), max: max === null ? '' : String(max) }
      })
    } else {
      sectionId.value =
        props.defaultSectionId !== null
          ? String(props.defaultSectionId)
          : props.sections[0]
            ? String(props.sections[0].id)
            : ''
      name.value = ''
      description.value = ''
      countable.value = false
      classPrices.value = emptyClassPrices()
    }
    error.value = null
    fieldErrors.value = {}
  },
)

type ParsedPrice =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'invalid' }

function parsePrice(raw: string): ParsedPrice {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: 'invalid' }
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000) return { ok: false, reason: 'invalid' }
  return { ok: true, value: n }
}

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  fieldErrors.value = {}
  error.value = null

  const trimmedName = name.value.trim()
  const errs: Record<string, string> = {}

  const sectionIdNum = Number(sectionId.value)
  if (!Number.isInteger(sectionIdNum) || sectionIdNum <= 0) {
    errs.sectionId = 'Выберите раздел'
  }
  if (trimmedName.length === 0) errs.name = 'Укажите название услуги'
  if (trimmedName.length > 200) errs.name = 'Максимум 200 символов'

  // Empty max means a fixed price; a max equal to min collapses to fixed too.
  const parsedPrices: { min: number; max: number | null }[] = []
  classPrices.value.forEach((cp, i) => {
    const n = i + 1
    const parsedMin = parsePrice(cp.min)
    if (!parsedMin.ok) {
      errs[`priceClass${n}Min`] = parsedMin.reason === 'empty' ? 'Укажите цену' : 'Целое число ≥ 0'
      return
    }
    let max: number | null = null
    const maxTrimmed = cp.max.trim()
    if (maxTrimmed.length > 0) {
      const parsedMax = parsePrice(maxTrimmed)
      if (!parsedMax.ok) {
        errs[`priceClass${n}Max`] = 'Целое число ≥ 0'
        return
      }
      if (parsedMax.value < parsedMin.value) {
        errs[`priceClass${n}Max`] = 'Не меньше цены «от»'
        return
      }
      max = parsedMax.value === parsedMin.value ? null : parsedMax.value
    }
    parsedPrices.push({ min: parsedMin.value, max })
  })

  const [c1, c2, c3, c4] = parsedPrices
  if (Object.keys(errs).length > 0 || !c1 || !c2 || !c3 || !c4) {
    fieldErrors.value = errs
    return
  }

  const payload = {
    sectionId: sectionIdNum,
    name: trimmedName,
    description: description.value.trim() === '' ? null : description.value.trim(),
    countable: countable.value,
    priceClass1Min: c1.min,
    priceClass1Max: c1.max,
    priceClass2Min: c2.min,
    priceClass2Max: c2.max,
    priceClass3Min: c3.min,
    priceClass3Max: c3.max,
    priceClass4Min: c4.min,
    priceClass4Max: c4.max,
  }

  submitting.value = true
  try {
    const result = props.service
      ? await updateService(props.service.id, payload)
      : await createService(payload)

    if (result.ok) {
      toast.success(isEdit.value ? 'Услуга обновлена' : 'Услуга добавлена')
      emit('saved')
      emit('update:open', false)
      return
    }

    if (result.error === 'validation') {
      const issues = result.issues
      const mapped: Record<string, string> = {}
      for (const i of issues) {
        const key = i.path.join('.') || '_'
        mapped[key] = i.message
      }
      fieldErrors.value = mapped
      error.value = issues[0]?.message ?? 'Неверные данные'
    } else if (result.error === 'conflict') {
      error.value = 'Конфликт: услугу нельзя сохранить'
    } else if (result.error === 'not_found') {
      error.value = 'Услуга не найдена — возможно, была удалена'
    } else if (result.error === 'unavailable') {
      error.value = result.message
    } else {
      error.value = 'Не удалось сохранить услугу'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Редактировать услугу' : 'Новая услуга' }}</DialogTitle>
        <DialogDescription>
          Укажите фиксированную цену или диапазон «от – до»
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="service-section">Раздел</Label>
          <Select v-model="sectionId" :disabled="submitting">
            <SelectTrigger id="service-section" class="w-full">
              <SelectValue placeholder="Выберите раздел" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="s in sections"
                :key="s.id"
                :value="String(s.id)"
              >
                {{ s.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="fieldErrors.sectionId" class="text-sm text-destructive">
            {{ fieldErrors.sectionId }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="service-name">Название</Label>
          <Input
            id="service-name"
            v-model="name"
            placeholder="Например: Двухэтапная полировка"
            :disabled="submitting"
            autocomplete="off"
            maxlength="200"
          />
          <p v-if="fieldErrors.name" class="text-sm text-destructive">
            {{ fieldErrors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="service-description">Примечание</Label>
          <Textarea
            id="service-description"
            v-model="description"
            placeholder="Необязательно"
            :disabled="submitting"
            rows="3"
            maxlength="2000"
          />
          <p v-if="fieldErrors.description" class="text-sm text-destructive">
            {{ fieldErrors.description }}
          </p>
        </div>

        <div class="flex items-start gap-2">
          <Checkbox
            id="service-countable"
            :model-value="countable"
            :disabled="submitting"
            class="mt-0.5"
            @update:model-value="(v) => (countable = v === true)"
          />
          <div class="grid gap-0.5">
            <Label for="service-countable" class="cursor-pointer">Штучная услуга</Label>
            <p class="text-xs text-muted-foreground">
              В форме записи можно указать количество; сумма считается как цена × количество
            </p>
          </div>
        </div>

        <div class="grid gap-2">
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span class="w-12 shrink-0"></span>
            <span class="flex-1">Цена, ₽</span>
            <span class="flex-1">до, ₽ (необязательно)</span>
          </div>
          <div v-for="(cp, i) in classPrices" :key="i" class="flex items-start gap-2">
            <Label :for="`service-price-${i + 1}-min`" class="w-12 shrink-0 pt-2.5">
              {{ ROMAN[i] }} кл.
            </Label>
            <div class="flex-1 grid gap-1">
              <Input
                :id="`service-price-${i + 1}-min`"
                v-model="cp.min"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="5 000"
                :disabled="submitting"
              />
              <p v-if="fieldErrors[`priceClass${i + 1}Min`]" class="text-sm text-destructive">
                {{ fieldErrors[`priceClass${i + 1}Min`] }}
              </p>
            </div>
            <div class="flex-1 grid gap-1">
              <Input
                :id="`service-price-${i + 1}-max`"
                v-model="cp.max"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="—"
                :disabled="submitting"
              />
              <p v-if="fieldErrors[`priceClass${i + 1}Max`]" class="text-sm text-destructive">
                {{ fieldErrors[`priceClass${i + 1}Max`] }}
              </p>
            </div>
          </div>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="gap-2">
          <Button type="button" variant="ghost" :disabled="submitting" @click="close">
            Отмена
          </Button>
          <Button type="submit" :disabled="submitting">
            {{ submitting ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
