<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  createSection,
  updateSection,
  type PricelistSectionRow,
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

const props = defineProps<{
  open: boolean
  section: PricelistSectionRow | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

const name = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

const isEdit = computed(() => props.section !== null)

watch(
  () => props.open,
  (v) => {
    if (v) {
      name.value = props.section?.name ?? ''
      error.value = null
    }
  },
)

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  const trimmed = name.value.trim()
  if (trimmed.length === 0) {
    error.value = 'Укажите название раздела'
    return
  }

  submitting.value = true
  error.value = null
  try {
    const result = props.section
      ? await updateSection(props.section.id, { name: trimmed })
      : await createSection({ name: trimmed })

    if (result.ok) {
      toast.success(isEdit.value ? 'Раздел обновлён' : 'Раздел добавлен')
      emit('saved')
      emit('update:open', false)
      return
    }

    if (result.error === 'validation') {
      error.value = result.issues[0]?.message ?? 'Неверные данные'
    } else if (result.error === 'conflict' && result.reason === 'duplicate_name') {
      error.value = 'Раздел с таким названием уже есть'
    } else if (result.error === 'not_found') {
      error.value = 'Раздел не найден — возможно, был удалён'
    } else if (result.error === 'unavailable') {
      error.value = result.message
    } else {
      error.value = 'Не удалось сохранить раздел'
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
        <DialogTitle>{{ isEdit ? 'Редактировать раздел' : 'Новый раздел' }}</DialogTitle>
        <DialogDescription>
          Раздел группирует услуги в прайс-листе
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="section-name">Название</Label>
          <Input
            id="section-name"
            v-model="name"
            placeholder="Например: Полировка"
            :disabled="submitting"
            autocomplete="off"
            maxlength="120"
          />
          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        </div>

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
