<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Plus, Trash2 } from '@lucide/vue'
import {
  createClient,
  updateClient,
  type Client,
} from '@/lib/clients-api'
import { formatPastedPhone, usePhoneInput } from '@/composables/use-phone-input'
import { maskLicensePlate } from '@/lib/license-plate'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const props = defineProps<{
  open: boolean
  client: Client | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

interface CarRow {
  makeModel: string
  plate: string
}

const name = ref('')
const cars = ref<CarRow[]>([])
const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const {
  phoneRaw,
  effectivePhone,
  onPhoneInput,
  onPhoneKeydown,
  onPhonePaste,
  onClickPastePhone,
  resetPhone,
} = usePhoneInput()

const isEdit = computed(() => props.client !== null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    name.value = props.client?.name ?? ''
    if (props.client?.phone) {
      phoneRaw.value = formatPastedPhone(props.client.phone)
    } else {
      resetPhone()
    }
    cars.value = props.client?.cars.map((c) => ({ makeModel: c.makeModel, plate: c.plate })) ?? []
    error.value = null
    fieldErrors.value = {}
  },
)

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

function addCar() {
  cars.value.push({ makeModel: '', plate: '' })
}

function removeCar(index: number) {
  cars.value.splice(index, 1)
}

// Unlike BookingForm's plate input, this one is one-way bound (`:model-value`)
// rather than `v-model`, so the mask is the sole source of truth — no need to
// only reassign on change to avoid a double-write race.
function onPlateInput(index: number, e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  // Gboard держит набираемое слово в композиции до пробела/коммита; правка
  // value/каретки в этот момент сбивает сессию ввода. Маскируем только уже
  // закоммиченный текст — закрывающий `input` приходит без флага композиции.
  if (e instanceof InputEvent && e.isComposing) {
    cars.value[index]!.plate = target.value
    return
  }
  const masked = maskLicensePlate(target.value)
  if (target.value !== masked) {
    target.value = masked
    target.setSelectionRange(masked.length, masked.length)
  }
  cars.value[index]!.plate = masked
}

async function submit() {
  fieldErrors.value = {}
  error.value = null

  const trimmedName = name.value.trim()
  const phone = effectivePhone()
  const errs: Record<string, string> = {}

  if (phone.length === 0) errs.phone = 'Укажите номер телефона'
  if (trimmedName.length > 120) errs.name = 'Максимум 120 символов'

  if (Object.keys(errs).length > 0) {
    fieldErrors.value = errs
    return
  }

  // Full-replace semantics on the server — drop rows never filled in rather
  // than sending blanks it would reject.
  const carsPayload = cars.value
    .map((c) => ({ makeModel: c.makeModel.trim(), plate: c.plate.trim() }))
    .filter((c) => c.makeModel.length > 0)

  const payload = { name: trimmedName, phone, cars: carsPayload }

  submitting.value = true
  try {
    const result = props.client
      ? await updateClient(props.client.id, payload)
      : await createClient(payload)

    if (result.ok) {
      toast.success(isEdit.value ? 'Клиент обновлён' : 'Клиент добавлен')
      emit('saved')
      emit('update:open', false)
      return
    }

    if (result.error === 'validation') {
      const mapped: Record<string, string> = {}
      for (const i of result.issues) {
        const key = i.path.join('.') || '_'
        mapped[key] = i.message
      }
      fieldErrors.value = mapped
      error.value = result.issues[0]?.message ?? 'Неверные данные'
    } else if (result.error === 'conflict' && result.reason === 'duplicate_phone') {
      fieldErrors.value = { phone: 'Клиент с таким телефоном уже есть' }
      error.value = 'Клиент с таким телефоном уже есть'
    } else if (result.error === 'not_found') {
      error.value = 'Клиент не найден — возможно, был удалён'
    } else if (result.error === 'unavailable') {
      error.value = result.message
    } else {
      error.value = 'Не удалось сохранить клиента'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Редактировать клиента' : 'Новый клиент' }}</DialogTitle>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="client-name">Имя</Label>
          <Input
            id="client-name"
            v-model="name"
            placeholder="Необязательно"
            :disabled="submitting"
            autocomplete="off"
            maxlength="120"
          />
          <p v-if="fieldErrors.name" class="text-sm text-destructive">
            {{ fieldErrors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="client-phone">Телефон</Label>
          <div class="relative">
            <Input
              id="client-phone"
              type="tel"
              inputmode="tel"
              class="pr-24"
              placeholder="+7 (___) ___-__-__"
              autocomplete="off"
              :disabled="submitting"
              :model-value="phoneRaw"
              @input="onPhoneInput"
              @keydown="onPhoneKeydown"
              @paste="onPhonePaste"
            />
            <button
              type="button"
              aria-label="Вставить номер из буфера обмена"
              class="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-3 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground text-xs font-medium disabled:opacity-50"
              :disabled="submitting"
              @click="onClickPastePhone"
            >
              Вставить
            </button>
          </div>
          <p v-if="fieldErrors.phone" class="text-sm text-destructive">
            {{ fieldErrors.phone }}
          </p>
        </div>

        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label>Машины</Label>
            <Button type="button" variant="outline" size="sm" :disabled="submitting" @click="addCar">
              <Plus class="size-4" /> Добавить машину
            </Button>
          </div>

          <!-- px/py дают место кольцу фокуса: overflow-y-auto клиппит и по X,
               иначе ring выделенного инпута срезается по краям. -mx компенсирует
               паддинг, чтобы инпуты остались выровнены с полями выше. -->
          <div v-if="cars.length > 0" class="grid gap-3 max-h-64 overflow-y-auto px-1.5 py-1.5 -mx-1.5">
            <div v-for="(car, index) in cars" :key="index" class="grid gap-1">
              <div class="flex items-center gap-2">
                <Input
                  v-model="car.makeModel"
                  placeholder="Марка и модель"
                  :disabled="submitting"
                  autocomplete="off"
                  maxlength="200"
                  class="flex-1"
                />
                <Input
                  :model-value="car.plate"
                  placeholder="А123АА777"
                  :disabled="submitting"
                  autocomplete="off"
                  autocapitalize="characters"
                  maxlength="9"
                  class="w-28"
                  @input="onPlateInput(index, $event)"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Удалить машину ${index + 1}`"
                  :disabled="submitting"
                  @click="removeCar(index)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </div>
              <p v-if="fieldErrors[`cars.${index}.makeModel`]" class="text-sm text-destructive">
                {{ fieldErrors[`cars.${index}.makeModel`] }}
              </p>
            </div>
          </div>
        </div>

        <p v-if="error && !fieldErrors.phone && !fieldErrors.name" class="text-sm text-destructive">
          {{ error }}
        </p>

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
