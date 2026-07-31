<script setup lang="ts">
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { rateInputSchema } from '@detailing-admin/shared'
import { setMasterRate } from '@/lib/salaries-api'
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
  masterId: number | null
  masterName: string
  currentRate: number | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

const rate = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (v) => {
    if (!v) return
    rate.value = props.currentRate != null ? String(props.currentRate) : ''
    error.value = null
  },
)

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  if (props.masterId == null) return
  error.value = null

  const parsed = rateInputSchema.safeParse({
    masterId: props.masterId,
    hourlyRate: Number(rate.value),
  })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Укажите ставку не меньше 1 ₽'
    return
  }

  submitting.value = true
  try {
    const result = await setMasterRate(parsed.data)
    if (result.ok) {
      toast.success('Ставка сохранена')
      emit('saved')
      emit('update:open', false)
      return
    }
    if (result.error === 'validation') {
      error.value = result.issues[0]?.message ?? 'Неверные данные'
    } else if (result.error === 'not_found') {
      error.value = 'Мастер не найден — возможно, был удалён'
    } else if (result.error === 'unavailable') {
      error.value = result.message
    } else {
      error.value = 'Не удалось сохранить ставку'
    }
  } catch {
    error.value = 'Не удалось сохранить ставку'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>Ставка мастера</DialogTitle>
        <DialogDescription>{{ masterName }}</DialogDescription>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="master-rate">Ставка, ₽/ч</Label>
          <Input
            id="master-rate"
            v-model="rate"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            placeholder="Например: 500"
            :disabled="submitting"
            autocomplete="off"
          />
          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
        </div>

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
