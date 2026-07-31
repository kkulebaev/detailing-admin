<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { Calendar as CalendarIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'
import {
  workHoursInputSchema,
  workHoursUpdateSchema,
  minutesToHours,
  type WorkHours,
} from '@detailing-admin/shared'
import {
  createWorkHours,
  updateWorkHours,
  type WorkHoursMutationResult,
} from '@/lib/salaries-api'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
  // When set the dialog edits that record; otherwise it creates a new one.
  editing: WorkHours | null
  // Target master. Fixed when adding from a row or editing (edit never re-assigns
  // the master or re-snapshots its rate). Null in the "add from the toolbar" flow,
  // where the master is picked from `masters` below.
  masterId: number | null
  masterName: string
  // Selectable masters for the toolbar flow — only those with a rate set, since
  // hours can't be logged without one. Ignored when masterId is fixed.
  masters?: { id: number; name: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'saved'): void
}>()

const isEdit = computed(() => props.editing !== null)
// Toolbar flow: no fixed master → show a picker. Edit and row-add keep it fixed.
const pickMaster = computed(() => !isEdit.value && props.masterId == null)
const selectedMasterId = ref<number | null>(null)
const effectiveMasterId = computed(() => props.masterId ?? selectedMasterId.value)

// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it).
const dateCal = shallowRef<DateValue | undefined>(undefined)
const dateOpen = ref(false)
const hours = ref('')
const note = ref('')

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

function isoToCal(iso: string): DateValue | undefined {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return undefined
  try {
    return new CalendarDate(y, m, d)
  } catch {
    return undefined
  }
}

function calToIso(d: DateValue): string {
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}

function calToDdmmyyyy(d: DateValue): string {
  const dd = String(d.day).padStart(2, '0')
  const mm = String(d.month).padStart(2, '0')
  return `${dd}.${mm}.${d.year}`
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    const e = props.editing
    error.value = null
    fieldErrors.value = {}
    selectedMasterId.value = null
    dateCal.value = e ? isoToCal(e.workDate) : undefined
    hours.value = e ? String(minutesToHours(e.minutes)) : ''
    note.value = e?.note ?? ''
  },
)

function onDateSelect(d: DateValue | undefined) {
  if (d) dateCal.value = d
  dateOpen.value = false
}

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  fieldErrors.value = {}
  error.value = null

  const workDate = dateCal.value ? calToIso(dateCal.value) : ''
  const hoursNum = Number(hours.value)
  const trimmedNote = note.value.trim()

  if (isEdit.value) {
    const parsed = workHoursUpdateSchema.safeParse({
      workDate,
      hours: hoursNum,
      note: trimmedNote,
    })
    if (!parsed.success) {
      applyIssues(parsed.error.issues)
      return
    }
    submitting.value = true
    try {
      const result = await updateWorkHours(props.editing!.id, parsed.data)
      handleResult(result, 'Запись обновлена')
    } catch {
      error.value = 'Не удалось сохранить запись'
    } finally {
      submitting.value = false
    }
    return
  }

  if (effectiveMasterId.value == null) {
    fieldErrors.value = { masterId: 'Выберите мастера' }
    error.value = 'Выберите мастера'
    return
  }
  const parsed = workHoursInputSchema.safeParse({
    masterId: effectiveMasterId.value,
    workDate,
    hours: hoursNum,
    note: trimmedNote,
  })
  if (!parsed.success) {
    applyIssues(parsed.error.issues)
    return
  }
  submitting.value = true
  try {
    const result = await createWorkHours(parsed.data)
    handleResult(result, 'Часы добавлены')
  } catch {
    error.value = 'Не удалось сохранить запись'
  } finally {
    submitting.value = false
  }
}

function applyIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }>,
) {
  const mapped: Record<string, string> = {}
  for (const i of issues) {
    const key = String(i.path[0] ?? '_')
    if (!(key in mapped)) mapped[key] = i.message
  }
  fieldErrors.value = mapped
  error.value = issues[0]?.message ?? 'Проверьте заполнение полей'
}

function handleResult(result: WorkHoursMutationResult, successMsg: string) {
  if (result.ok) {
    toast.success(successMsg)
    emit('saved')
    emit('update:open', false)
    return
  }
  if (result.error === 'validation') {
    // POST /hours surfaces the "no rate set" precondition as a reason literal.
    if ('reason' in result && result.reason === 'no_rate') {
      error.value = 'Сначала задайте ставку мастеру'
      return
    }
    if ('issues' in result) {
      applyIssues(result.issues)
      return
    }
    error.value = 'Неверные данные'
  } else if (result.error === 'not_found') {
    error.value = 'Запись не найдена — возможно, была удалена'
  } else if (result.error === 'unavailable') {
    error.value = result.message ?? 'База данных недоступна'
  } else {
    error.value = 'Не удалось сохранить запись'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Редактировать часы' : 'Добавить часы' }}</DialogTitle>
        <DialogDescription v-if="pickMaster">Выберите мастера и заполните часы</DialogDescription>
        <DialogDescription v-else>{{ masterName }}</DialogDescription>
      </DialogHeader>

      <form class="grid gap-4 py-2" @submit.prevent="submit">
        <!-- Мастер (только когда не задан заранее) -->
        <div v-if="pickMaster" class="grid gap-2">
          <Label>Мастер</Label>
          <Select
            :model-value="selectedMasterId != null ? String(selectedMasterId) : undefined"
            :disabled="submitting"
            @update:model-value="(v) => (selectedMasterId = v ? Number(v) : null)"
          >
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Выберите мастера" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in masters ?? []" :key="m.id" :value="String(m.id)">
                {{ m.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="fieldErrors.masterId" class="text-sm text-destructive">
            {{ fieldErrors.masterId }}
          </p>
        </div>

        <!-- Дата -->
        <div class="grid gap-2">
          <Label>Дата</Label>
          <Popover v-model:open="dateOpen">
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="outline"
                class="justify-start gap-2 font-normal"
                :disabled="submitting"
              >
                <CalendarIcon class="size-4" />
                <span :class="{ 'text-muted-foreground': !dateCal }">
                  {{ dateCal ? calToDdmmyyyy(dateCal) : 'ДД.ММ.ГГГГ' }}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-auto p-0" align="start">
              <Calendar
                locale="ru-RU"
                :model-value="dateCal"
                @update:model-value="onDateSelect"
              />
            </PopoverContent>
          </Popover>
          <p v-if="fieldErrors.workDate" class="text-sm text-destructive">
            {{ fieldErrors.workDate }}
          </p>
        </div>

        <!-- Часы -->
        <div class="grid gap-2">
          <Label for="work-hours">Часы</Label>
          <Input
            id="work-hours"
            v-model="hours"
            type="number"
            inputmode="decimal"
            min="0.25"
            max="24"
            step="0.25"
            placeholder="Например: 7.5"
            :disabled="submitting"
            autocomplete="off"
          />
          <p v-if="fieldErrors.hours" class="text-sm text-destructive">
            {{ fieldErrors.hours }}
          </p>
        </div>

        <!-- Заметка -->
        <div class="grid gap-2">
          <Label for="work-note">
            Заметка <span class="text-muted-foreground font-normal">(необязательно)</span>
          </Label>
          <Textarea
            id="work-note"
            v-model="note"
            rows="2"
            class="[field-sizing:content]"
            :disabled="submitting"
            maxlength="500"
          />
          <p v-if="fieldErrors.note" class="text-sm text-destructive">
            {{ fieldErrors.note }}
          </p>
        </div>

        <p
          v-if="error && Object.keys(fieldErrors).length === 0"
          class="text-sm text-destructive"
        >
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
