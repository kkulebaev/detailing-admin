<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  createMaster,
  updateMaster,
  type Master,
} from '@/lib/masters-api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  editing: Master | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

const name = ref('')
const canBeResponsible = ref(true)
const telegramId = ref('')

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const isEdit = computed(() => props.editing !== null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    const m = props.editing
    name.value = m?.name ?? ''
    canBeResponsible.value = m?.canBeResponsible ?? true
    telegramId.value = m?.telegramId ?? ''
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
  const errs: Record<string, string> = {}
  if (trimmedName.length === 0) errs.name = 'Укажите имя мастера'
  else if (trimmedName.length > 120) errs.name = 'Максимум 120 символов'
  else if (/^[=+\-@]/.test(trimmedName)) errs.name = 'Недопустимое имя'

  if (Object.keys(errs).length > 0) {
    fieldErrors.value = errs
    return
  }

  const trimmedTelegram = telegramId.value.trim()
  const payload = {
    name: trimmedName,
    canBeResponsible: canBeResponsible.value,
    telegramId: trimmedTelegram === '' ? null : trimmedTelegram,
  }

  submitting.value = true
  try {
    const result = props.editing
      ? await updateMaster(props.editing.id, payload)
      : await createMaster(payload)

    if (result.ok) {
      toast.success(isEdit.value ? 'Мастер обновлён' : 'Мастер добавлен')
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
    } else if (result.error === 'conflict' && result.reason === 'duplicate_name') {
      fieldErrors.value = { name: 'Мастер с таким именем уже существует' }
      error.value = 'Мастер с таким именем уже существует'
    } else if (result.error === 'not_found') {
      error.value = 'Мастер не найден — возможно, был удалён'
    } else if (result.error === 'unavailable') {
      error.value = result.message
    } else {
      error.value = 'Не удалось сохранить мастера'
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
        <DialogTitle>{{ isEdit ? 'Редактировать мастера' : 'Новый мастер' }}</DialogTitle>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="master-name">Имя</Label>
          <Input
            id="master-name"
            v-model="name"
            placeholder="Например: Иван"
            :disabled="submitting"
            autocomplete="off"
            maxlength="120"
          />
          <p v-if="fieldErrors.name" class="text-sm text-destructive">
            {{ fieldErrors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="master-telegram">
            Telegram ID
            <span class="text-muted-foreground font-normal">(для уведомлений, необязательно)</span>
          </Label>
          <Input
            id="master-telegram"
            v-model="telegramId"
            placeholder="Например: 123456789"
            :disabled="submitting"
            autocomplete="off"
            maxlength="64"
          />
        </div>

        <div class="flex items-center gap-2">
          <Checkbox
            id="master-can-be-responsible"
            :model-value="canBeResponsible"
            :disabled="submitting"
            @update:model-value="(v) => (canBeResponsible = v === true)"
          />
          <Label for="master-can-be-responsible" class="cursor-pointer">Может быть ответственным</Label>
        </div>

        <p v-if="error && !fieldErrors.name" class="text-sm text-destructive">
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
