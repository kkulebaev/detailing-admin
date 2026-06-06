<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  createClient,
  updateClient,
  type Client,
} from '@/lib/clients-api'
import { formatPastedPhone, usePhoneInput } from '@/composables/use-phone-input'
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

const name = ref('')
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
    error.value = null
    fieldErrors.value = {}
  },
)

function close() {
  if (submitting.value) return
  emit('update:open', false)
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

  const payload = { name: trimmedName, phone }

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
