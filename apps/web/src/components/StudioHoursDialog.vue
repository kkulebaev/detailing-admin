<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useQueryCache } from '@pinia/colada'
import { WEEKDAY_SHORT, timeToMinutes, type StudioDay } from '@detailing-admin/shared'
import { STUDIO_HOURS_KEY } from '@/lib/queries'
import { saveStudioHours } from '@/lib/schedule-api'
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
import { Switch } from '@/components/ui/switch'

const WEEKDAY_FULL = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
] as const

const DEFAULT_OPENS = '10:00'
const DEFAULT_CLOSES = '20:00'

const props = defineProps<{ open: boolean; days: readonly StudioDay[] }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

interface Row {
  open: boolean
  opensAt: string
  closesAt: string
}

const rows = reactive<Row[]>(
  WEEKDAY_SHORT.map(() => ({ open: false, opensAt: DEFAULT_OPENS, closesAt: DEFAULT_CLOSES })),
)
const saving = ref(false)
const submitted = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    submitted.value = false
    rows.forEach((row, weekday) => {
      const day = props.days.find((d) => d.weekday === weekday)
      row.open = day !== undefined
      row.opensAt = day?.opensAt ?? DEFAULT_OPENS
      row.closesAt = day?.closesAt ?? DEFAULT_CLOSES
    })
  },
  { immediate: true },
)

// Включенный день берет часы ближайшего рабочего дня выше: обычно у студии одни
// часы на всю неделю, и вводить их семь раз незачем.
function onToggle(weekday: number, open: boolean) {
  const row = rows[weekday]!
  row.open = open
  if (!open) return
  const prev = rows
    .slice(0, weekday)
    .reverse()
    .find((r) => r.open)
  if (prev) {
    row.opensAt = prev.opensAt
    row.closesAt = prev.closesAt
  }
}

// `<input type="time">` отдает пустую строку, пока время не введено целиком.
function rowError(row: Row): string | null {
  if (!row.open) return null
  if (!row.opensAt || !row.closesAt) return 'Укажите время'
  if (timeToMinutes(row.opensAt) >= timeToMinutes(row.closesAt))
    return 'Закрытие должно быть позже открытия'
  return null
}

const noneOpen = computed(() => rows.every((r) => !r.open))
const hasErrors = computed(() => noneOpen.value || rows.some((r) => rowError(r) !== null))

const queryCache = useQueryCache()

async function save() {
  submitted.value = true
  if (hasErrors.value || saving.value) return
  saving.value = true
  try {
    const days = rows.flatMap((r, weekday) =>
      r.open ? [{ weekday, opensAt: r.opensAt, closesAt: r.closesAt }] : [],
    )
    const result = await saveStudioHours({ days })
    if (!result.ok) {
      toast.error(
        result.error === 'unavailable' ? result.message : 'Не удалось сохранить режим работы',
      )
      return
    }
    await queryCache.invalidateQueries({ key: STUDIO_HOURS_KEY }).catch(() => {})
    toast.success('Режим работы сохранен')
    emit('update:open', false)
  } catch {
    toast.error('Не удалось сохранить режим работы')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-h-svh overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Режим работы студии</DialogTitle>
        <DialogDescription>Рабочие дни недели и часы работы</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" novalidate @submit.prevent="save">
        <div class="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          <div v-for="(row, weekday) in rows" :key="weekday" class="px-3 py-2">
            <div class="flex min-h-10 items-center gap-3">
              <Switch
                :id="`studio-day-${weekday}`"
                :model-value="row.open"
                :aria-label="WEEKDAY_FULL[weekday]"
                @update:model-value="(v: boolean) => onToggle(weekday, v)"
              />
              <label
                :for="`studio-day-${weekday}`"
                class="min-w-0 flex-1 truncate text-sm font-medium transition-colors"
                :class="row.open ? 'text-foreground' : 'text-muted-foreground'"
              >
                {{ WEEKDAY_FULL[weekday] }}
              </label>
              <div v-if="row.open" class="flex w-44 shrink-0 items-center">
                <Input
                  v-model="row.opensAt"
                  type="time"
                  class="h-10 w-20 px-1 text-center tabular-nums [&::-webkit-calendar-picker-indicator]:hidden"
                  :aria-label="`${WEEKDAY_FULL[weekday]}: открытие`"
                />
                <span class="w-4 text-center text-muted-foreground" aria-hidden="true">–</span>
                <Input
                  v-model="row.closesAt"
                  type="time"
                  class="h-10 w-20 px-1 text-center tabular-nums [&::-webkit-calendar-picker-indicator]:hidden"
                  :aria-label="`${WEEKDAY_FULL[weekday]}: закрытие`"
                />
              </div>
              <span v-else class="w-44 shrink-0 text-center text-sm text-muted-foreground">
                Выходной
              </span>
            </div>
            <p v-if="submitted && rowError(row)" class="pb-1 pl-12 text-xs text-destructive">
              {{ rowError(row) }}
            </p>
          </div>
        </div>

        <p v-if="submitted && noneOpen" class="text-sm text-destructive">
          Отметьте хотя бы один рабочий день
        </p>

        <DialogFooter class="gap-2">
          <Button
            type="button"
            variant="outline"
            :disabled="saving"
            @click="emit('update:open', false)"
          >
            Отмена
          </Button>
          <Button type="submit" :disabled="saving">
            {{ saving ? 'Сохранение…' : 'Сохранить' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
