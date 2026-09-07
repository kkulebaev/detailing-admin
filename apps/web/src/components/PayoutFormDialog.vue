<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { Calendar as CalendarIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { DateValue } from 'reka-ui'
import { CalendarDate } from '@internationalized/date'
import { payoutInputSchema, payoutUpdateSchema, type Payout } from '@detailing-admin/shared'
import { calToDdmmyyyy } from '@/lib/date'
import { createPayout, updatePayout, type PayoutMutationResult } from '@/lib/salaries-api'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type Direction = 'accrual' | 'deduction'

const props = defineProps<{
  open: boolean
  // When set the dialog edits that payout; otherwise it creates a new one.
  editing: Payout | null
  // Target master. Fixed when adding from a row or editing (edit never
  // re-assigns the master). Null in the "add from the toolbar" flow, where the
  // master is picked from `masters` below.
  masterId: number | null
  masterName: string
  // Selectable masters for the toolbar flow — every row of the sheet, not only
  // those with a rate: a payout needs no rate.
  masters?: { id: number; name: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  // Carries the master the row landed on — taken from the server's response,
  // not from the prop, because the toolbar flow picks the master in-dialog.
  (e: 'saved', masterId: number): void
}>()

const isEdit = computed(() => props.editing !== null)
// Toolbar flow: no fixed master → show a picker. Edit and row-add keep it fixed.
const pickMaster = computed(() => !isEdit.value && props.masterId == null)
const selectedMasterId = ref<number | null>(null)
const effectiveMasterId = computed(() => props.masterId ?? selectedMasterId.value)

// shallowRef preserves CalendarDate's #private field (Vue's UnwrapRef strips it).
const dateCal = shallowRef<DateValue | undefined>(undefined)
const dateOpen = ref(false)
// The sign is carried by this toggle, never typed: `inputmode="numeric"` gives
// no minus key on Android, and dropping inputmode would open the IME
// composition path the input masks fight elsewhere.
const direction = ref<Direction>('accrual')
const amount = ref('')
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

watch(
  () => props.open,
  (v) => {
    if (!v) return
    const e = props.editing
    error.value = null
    fieldErrors.value = {}
    selectedMasterId.value = null
    dateCal.value = e ? isoToCal(e.payoutDate) : undefined
    // The stored amount is signed; the form splits it back into direction +
    // magnitude so the field only ever holds a positive number.
    direction.value = e && e.amount < 0 ? 'deduction' : 'accrual'
    amount.value = e ? String(Math.abs(e.amount)) : ''
    note.value = e?.note ?? ''
  },
)

function onDateSelect(d: DateValue | undefined) {
  if (d) dateCal.value = d
  dateOpen.value = false
}

// reka-ui clears a single-select ToggleGroup when the active item is clicked
// again — ignore the empty value instead of falling into an unset direction.
function onDirectionChange(v: unknown) {
  if (v === 'accrual' || v === 'deduction') direction.value = v
}

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

async function submit() {
  fieldErrors.value = {}
  error.value = null

  // The date comes from a calendar, never from typing, so an empty field means
  // "not picked yet". Letting the schema answer would surface its ГГГГ-ММ-ДД
  // format message about a format the user never enters — the trigger shows
  // ДД.ММ.ГГГГ.
  if (!dateCal.value) {
    fieldErrors.value = { payoutDate: 'Укажите дату' }
    return
  }
  const payoutDate = calToIso(dateCal.value)
  const trimmedNote = note.value.trim()
  // An empty field reads as 0 here, which the same guard rejects — the sign
  // never comes from this number, only its magnitude does.
  const magnitude = Number(amount.value)
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    fieldErrors.value = { amount: 'Укажите сумму больше нуля' }
    return
  }
  const signed = direction.value === 'deduction' ? -magnitude : magnitude

  if (isEdit.value) {
    const parsed = payoutUpdateSchema.safeParse({
      payoutDate,
      amount: signed,
      note: trimmedNote,
    })
    if (!parsed.success) {
      applyIssues(parsed.error.issues)
      return
    }
    submitting.value = true
    try {
      const result = await updatePayout(props.editing!.id, parsed.data)
      handleResult(result, 'Выплата обновлена')
    } catch {
      error.value = 'Не удалось сохранить выплату'
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
  const parsed = payoutInputSchema.safeParse({
    masterId: effectiveMasterId.value,
    payoutDate,
    amount: signed,
    note: trimmedNote,
  })
  if (!parsed.success) {
    applyIssues(parsed.error.issues)
    return
  }
  submitting.value = true
  try {
    const result = await createPayout(parsed.data)
    handleResult(result, 'Выплата добавлена')
  } catch {
    error.value = 'Не удалось сохранить выплату'
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

function handleResult(result: PayoutMutationResult, successMsg: string) {
  if (result.ok) {
    toast.success(successMsg)
    emit('saved', result.payout.masterId)
    emit('update:open', false)
    return
  }
  if (result.error === 'validation') {
    if ('issues' in result) {
      applyIssues(result.issues)
      return
    }
    error.value = 'Неверные данные'
  } else if (result.error === 'not_found') {
    // POST /payouts 404s only on an unknown master (the payout doesn't exist
    // yet); PATCH 404s on the payout itself.
    error.value = isEdit.value
      ? 'Выплата не найдена — возможно, была удалена'
      : 'Мастер не найден — возможно, был удалён'
  } else if (result.error === 'unavailable') {
    error.value = result.message ?? 'База данных недоступна'
  } else {
    error.value = 'Не удалось сохранить выплату'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Редактировать выплату' : 'Добавить выплату' }}</DialogTitle>
        <DialogDescription v-if="pickMaster">
          Выберите мастера и укажите сумму
        </DialogDescription>
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
          <p v-if="fieldErrors.payoutDate" class="text-sm text-destructive">
            {{ fieldErrors.payoutDate }}
          </p>
        </div>

        <!-- Направление -->
        <div class="grid gap-2">
          <Label>Направление</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            :model-value="direction"
            :disabled="submitting"
            @update:model-value="onDirectionChange"
          >
            <ToggleGroupItem value="accrual" aria-label="Начисление">
              Начисление
            </ToggleGroupItem>
            <ToggleGroupItem value="deduction" aria-label="Удержание">
              Удержание
            </ToggleGroupItem>
          </ToggleGroup>
          <p class="text-xs text-muted-foreground">Удержание уменьшает итог за месяц</p>
        </div>

        <!-- Сумма -->
        <div class="grid gap-2">
          <Label for="payout-amount">Сумма ₽</Label>
          <Input
            id="payout-amount"
            v-model="amount"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            placeholder="Например: 2000"
            :disabled="submitting"
            autocomplete="off"
          />
          <p v-if="fieldErrors.amount" class="text-sm text-destructive">
            {{ fieldErrors.amount }}
          </p>
        </div>

        <!-- Комментарий -->
        <div class="grid gap-2">
          <Label for="payout-note">
            Комментарий <span class="text-muted-foreground font-normal">(необязательно)</span>
          </Label>
          <Textarea
            id="payout-note"
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
