<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  createService,
  updateService,
  type PricelistSection,
  type PricelistService,
} from '@/lib/pricelist-api'
import { Button } from '@/components/ui/button'
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

const sectionId = ref<string>('')
const name = ref('')
const description = ref('')
const prices = ref<[string, string, string, string]>(['', '', '', ''])

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

watch(
  () => props.open,
  (v) => {
    if (!v) return
    if (props.service) {
      sectionId.value = String(props.service.sectionId)
      name.value = props.service.name
      description.value = props.service.description ?? ''
      prices.value = [
        props.service.priceClass1 === null ? '' : String(props.service.priceClass1),
        props.service.priceClass2 === null ? '' : String(props.service.priceClass2),
        props.service.priceClass3 === null ? '' : String(props.service.priceClass3),
        props.service.priceClass4 === null ? '' : String(props.service.priceClass4),
      ]
    } else {
      sectionId.value =
        props.defaultSectionId !== null
          ? String(props.defaultSectionId)
          : props.sections[0]
            ? String(props.sections[0].id)
            : ''
      name.value = ''
      description.value = ''
      prices.value = ['', '', '', '']
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

function isPriceOk(p: ParsedPrice): p is Extract<ParsedPrice, { ok: true }> {
  return p.ok
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

  const parsed = prices.value.map(parsePrice)
  parsed.forEach((p, i) => {
    if (!p.ok) {
      errs[`price${i + 1}`] = p.reason === 'empty' ? 'Укажите цену' : 'Целое число ≥ 0'
    }
  })

  if (Object.keys(errs).length > 0) {
    fieldErrors.value = errs
    return
  }

  // After the errs short-circuit, every entry is `ok: true`. `every` with a
  // type predicate narrows the array element type so the payload reads
  // `.value` without an assertion.
  if (!parsed.every(isPriceOk)) {
    fieldErrors.value = errs
    return
  }

  const payload = {
    sectionId: sectionIdNum,
    name: trimmedName,
    description: description.value.trim() === '' ? null : description.value.trim(),
    priceClass1: parsed[0].value,
    priceClass2: parsed[1].value,
    priceClass3: parsed[2].value,
    priceClass4: parsed[3].value,
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
          Цена указывается за каждый класс автомобиля
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

        <div class="grid grid-cols-2 gap-3">
          <div v-for="i in 4" :key="i" class="grid gap-2">
            <Label :for="`service-price-${i}`">{{ ['I', 'II', 'III', 'IV'][i - 1] }} кл., ₽</Label>
            <Input
              :id="`service-price-${i}`"
              v-model="prices[i - 1]"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="—"
              :disabled="submitting"
            />
            <p
              v-if="fieldErrors[`price${i}`] || fieldErrors[`priceClass${i}`]"
              class="text-sm text-destructive"
            >
              {{ fieldErrors[`price${i}`] || fieldErrors[`priceClass${i}`] }}
            </p>
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
