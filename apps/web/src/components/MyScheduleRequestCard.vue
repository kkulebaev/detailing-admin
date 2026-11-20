<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useQueryCache } from '@pinia/colada'
import { MY_SCHEDULE_REQUESTS_KEY } from '@/lib/queries'
import { withdrawScheduleRequest, type ScheduleRequest } from '@/lib/schedule-requests-api'
import { formatDayList, formatSentAt } from '@/lib/schedule-format'
import { CircleCheck, CircleX, Clock } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  // Последние заявки сотрудника, свежие первыми.
  requests: readonly ScheduleRequest[]
}>()

// Решение показываем неделю: дольше оно уже не новость, а история не нужна.
const DECISION_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000

const queryCache = useQueryCache()
const withdrawing = ref(false)

const pending = computed(() => props.requests.find((r) => r.status === 'pending') ?? null)
const lastDecided = computed(() => {
  const r = props.requests.find((x) => x.status !== 'pending')
  if (!r?.decidedAt) return null
  return Date.now() - new Date(r.decidedAt).getTime() < DECISION_VISIBLE_MS ? r : null
})

function summary(r: ScheduleRequest): string[] {
  const working = r.days.filter((d) => d.working).map((d) => d.date)
  const off = r.days.filter((d) => !d.working).map((d) => d.date)
  return [
    working.length > 0 ? `Рабочие: ${formatDayList(working)}` : '',
    off.length > 0 ? `Выходные: ${formatDayList(off)}` : '',
  ].filter(Boolean)
}

async function withdraw() {
  if (!pending.value || withdrawing.value) return
  withdrawing.value = true
  try {
    const result = await withdrawScheduleRequest(pending.value.id)
    if (result.ok) toast.success('Заявка отозвана')
    else if (result.error === 'conflict') toast.error('Заявку уже рассмотрели')
    else toast.error('Не удалось отозвать заявку')
    await queryCache.invalidateQueries({ key: MY_SCHEDULE_REQUESTS_KEY }).catch(() => {})
  } catch {
    toast.error('Не удалось отозвать заявку')
  } finally {
    withdrawing.value = false
  }
}
</script>

<template>
  <div v-if="pending || lastDecided" class="mb-4 max-w-2xl">
    <div
      v-if="pending"
      class="grid gap-2 rounded-md border border-l-4 border-border border-l-primary p-3 text-sm sm:p-4"
    >
      <p class="flex items-center gap-2 font-semibold">
        <Clock class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Заявка на согласовании
      </p>
      <p class="text-muted-foreground">
        Отправлена {{ formatSentAt(pending.createdAt) }}. Запрошенные дни в графике показаны
        бледными, снятые — пунктиром.
      </p>
      <p v-for="line in summary(pending)" :key="line">{{ line }}</p>
      <Button
        variant="outline"
        size="sm"
        class="mt-1 h-10 w-full sm:h-8 sm:w-fit"
        :disabled="withdrawing"
        @click="withdraw"
      >
        Отозвать
      </Button>
    </div>
    <div
      v-else-if="lastDecided"
      class="grid gap-2 rounded-md border border-l-4 border-border p-3 text-sm sm:p-4"
      :class="lastDecided.status === 'rejected' ? 'border-l-destructive' : 'border-l-primary'"
    >
      <p class="flex items-center gap-2 font-semibold">
        <CircleX
          v-if="lastDecided.status === 'rejected'"
          class="size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <CircleCheck v-else class="size-4 shrink-0 text-primary" aria-hidden="true" />
        {{ lastDecided.status === 'approved' ? 'Заявка одобрена' : 'Заявка отклонена' }}
      </p>
      <p v-for="line in summary(lastDecided)" :key="line">{{ line }}</p>
      <p v-if="lastDecided.comment">Комментарий: {{ lastDecided.comment }}</p>
      <p v-if="lastDecided.decidedByName" class="text-xs text-muted-foreground">
        {{ lastDecided.decidedByName }}
      </p>
    </div>
  </div>
</template>
