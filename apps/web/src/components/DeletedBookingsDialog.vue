<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { RotateCcw } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { DeletedBooking } from '@detailing-admin/shared'
import { restoreBooking } from '@/lib/bookings-api'
import { useDeletedBookingsQuery, useInvalidateBookings } from '@/lib/queries'
import { formatAuditTime } from '@/lib/booking-audit'
import { isoToDdmmyyyy } from '@/lib/date'
import { formatAmount } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const { data, isLoading, error } = useDeletedBookingsQuery(toRef(props, 'open'))
const invalidateBookings = useInvalidateBookings()

const items = computed(() => (data.value?.ok ? data.value.items : []))
const failed = computed(() => error.value != null || (data.value != null && !data.value.ok))

const restoring = ref<string | null>(null)

function dateText(item: DeletedBooking): string {
  const b = item.booking
  const from = isoToDdmmyyyy(b.dateFrom)
  const date = b.dateTo ? `${from} – ${isoToDdmmyyyy(b.dateTo)}` : from
  return b.timeFrom ? `${date} · ${b.timeFrom}` : date
}

async function onRestore(item: DeletedBooking) {
  if (restoring.value) return
  restoring.value = item.booking.id
  try {
    const result = await restoreBooking(item.booking.id)
    if (result.ok) {
      toast.success('Запись восстановлена')
    } else if (result.error === 'conflict') {
      toast.error('Запись уже восстановлена')
    } else if (result.error === 'not_found') {
      toast.error('Запись не найдена в корзине')
    } else {
      toast.error(result.error === 'unavailable' ? result.message : 'Не удалось восстановить')
    }
    // В любом исходе список на сервере мог измениться — показываем актуальный.
    await invalidateBookings()
  } catch {
    toast.error('Не удалось восстановить')
  } finally {
    restoring.value = null
  }
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-h-svh max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Удаленные записи</DialogTitle>
        <DialogDescription>
          Последние 100 удалений. Восстановленная запись вернется в таблицу, но в Google Sheets ее
          удаление и восстановление не попадают.
        </DialogDescription>
      </DialogHeader>

      <div v-if="isLoading" class="space-y-2">
        <Skeleton class="h-20 w-full" />
        <Skeleton class="h-20 w-full" />
      </div>
      <p v-else-if="failed" class="text-sm text-destructive">Не удалось загрузить корзину</p>
      <p v-else-if="items.length === 0" class="text-sm text-muted-foreground">
        Удаленных записей нет
      </p>
      <ul v-else class="divide-y">
        <li
          v-for="item in items"
          :key="item.booking.id"
          class="flex items-start justify-between gap-3 py-3 text-sm"
        >
          <div class="min-w-0 space-y-0.5">
            <div class="font-medium break-words">{{ item.booking.car || 'Без машины' }}</div>
            <div class="break-words">
              {{ item.booking.name || '—' }}
              <span v-if="item.booking.phone" class="tabular-nums text-muted-foreground">
                · {{ formatPhone(item.booking.phone) }}
              </span>
            </div>
            <div class="tabular-nums text-muted-foreground">
              {{ dateText(item) }}
              <template v-if="item.booking.amount != null">
                · {{ formatAmount(item.booking.amount) }} ₽
              </template>
            </div>
            <div class="text-xs text-muted-foreground">
              Удалил(а) {{ item.deletedBy }}, {{ formatAuditTime(item.deletedAt) }}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0 gap-1"
            :disabled="restoring !== null"
            @click="onRestore(item)"
          >
            <RotateCcw class="size-4" />
            {{ restoring === item.booking.id ? 'Восстановление…' : 'Восстановить' }}
          </Button>
        </li>
      </ul>
    </DialogContent>
  </Dialog>
</template>
