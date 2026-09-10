<script setup lang="ts">
import { computed } from 'vue'
import { Pencil, Trash2 } from '@lucide/vue'
import type { BookingRow, Readiness } from '@detailing-admin/shared'
import { isoToDdmmyyyy } from '@/lib/date'
import { formatPhone } from '@/lib/phone'
import ReadinessPicker from './ReadinessPicker.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Read-only view of one booking. In the compact table a row shows five fields
// out of thirteen; tapping it opens this. Admins get «Изменить»/«Удалить» in the
// footer — that's the only path to editing and deleting once the compact row
// drops its per-row buttons. Employees see the same fields without the footer:
// they can't PATCH bookings anyway, but they still need the phone and the note.
const props = defineProps<{
  open: boolean
  booking: BookingRow | null
  canEdit: boolean
  readinessSaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'edit', booking: BookingRow): void
  (e: 'delete', booking: BookingRow): void
  (e: 'readiness', value: Readiness | ''): void
}>()

const dateText = computed(() => {
  const b = props.booking
  if (!b) return ''
  const from = isoToDdmmyyyy(b.dateFrom)
  return b.dateTo ? `${from} – ${isoToDdmmyyyy(b.dateTo)}` : from
})

const timeText = computed(() => {
  const b = props.booking
  if (!b?.timeFrom) return '—'
  return b.timeTo ? `${b.timeFrom} – ${b.timeTo}` : b.timeFrom
})

function formatAmount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

// Иначе reka-ui уводит фокус на первый интерактивный элемент — ссылку-телефон,
// и та открывается с кольцом фокуса, читаясь как поле ввода. Фокус остаётся на
// самом диалоге, так что Escape и Tab работают как обычно.
function focusDialogItself(e: Event) {
  e.preventDefault()
  if (e.target instanceof HTMLElement) e.target.focus()
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent
      v-if="props.booking"
      class="max-w-md"
      @open-auto-focus="focusDialogItself"
    >
      <DialogHeader>
        <DialogTitle>{{ props.booking.car || 'Без машины' }}</DialogTitle>
        <DialogDescription>{{ dateText }} · {{ timeText }}</DialogDescription>
      </DialogHeader>

      <!-- `dl` в две колонки: подпись слева фиксированной ширины, значение
           переносится. Пустые поля показываем прочерком, а не прячем — иначе
           список полей прыгает от записи к записи. -->
      <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted-foreground">Имя</dt>
        <dd class="col-span-2 break-words">{{ props.booking.name || '—' }}</dd>

        <dt class="text-muted-foreground">Телефон</dt>
        <dd class="col-span-2">
          <a
            v-if="props.booking.phone"
            :href="`tel:${props.booking.phone}`"
            class="tabular-nums underline underline-offset-4"
          >
            {{ formatPhone(props.booking.phone) }}
          </a>
          <span v-else>—</span>
        </dd>

        <dt class="text-muted-foreground">Услуга</dt>
        <dd class="col-span-2 break-words whitespace-pre-line">{{ props.booking.service || '—' }}</dd>

        <template v-if="props.booking.amount != null">
          <dt class="text-muted-foreground">Сумма</dt>
          <dd class="col-span-2 tabular-nums">
            {{ formatAmount(props.booking.amount) }} ₽
            <span
              v-if="props.booking.amountFormula"
              class="block text-xs text-muted-foreground"
            >
              {{ props.booking.amountFormula }}
            </span>
          </dd>
        </template>

        <dt class="text-muted-foreground">Готовность</dt>
        <dd class="col-span-2">
          <ReadinessPicker
            :readiness="props.booking.readiness"
            :readonly="!props.canEdit"
            :disabled="props.readinessSaving"
            @update="(v) => emit('readiness', v)"
          />
        </dd>

        <dt class="text-muted-foreground">Мастер</dt>
        <dd class="col-span-2 break-words">
          {{ props.booking.master.length ? props.booking.master.join(', ') : '—' }}
        </dd>

        <dt class="text-muted-foreground">Ответственный</dt>
        <dd class="col-span-2 break-words">{{ props.booking.responsible || '—' }}</dd>

        <dt class="text-muted-foreground">Примечание</dt>
        <dd class="col-span-2 break-words">{{ props.booking.note || '—' }}</dd>
      </dl>

      <DialogFooter v-if="props.canEdit">
        <Button
          variant="ghost"
          class="gap-1 text-destructive"
          @click="emit('delete', props.booking)"
        >
          <Trash2 class="size-4" /> Удалить
        </Button>
        <Button class="gap-1" @click="emit('edit', props.booking)">
          <Pencil class="size-4" /> Изменить
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
