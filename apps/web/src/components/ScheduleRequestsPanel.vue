<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useQueryCache } from '@pinia/colada'
import { SCHEDULE_KEY, SCHEDULE_REQUESTS_KEY, usePendingScheduleRequestsQuery } from '@/lib/queries'
import {
  approveScheduleRequest,
  rejectScheduleRequest,
  type ScheduleRequest,
  type ScheduleRequestActionResult,
} from '@/lib/schedule-requests-api'
import { formatDayList, formatSentAt } from '@/lib/schedule-format'
import { CalendarDays } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import ScheduleRequestPreviewDialog from '@/components/ScheduleRequestPreviewDialog.vue'

const { data } = usePendingScheduleRequestsQuery(ref(true))
const queryCache = useQueryCache()

const requests = computed(() => (data.value?.ok ? data.value.requests : []))
const busyId = ref<number | null>(null)

const rejecting = ref<ScheduleRequest | null>(null)
const rejectOpen = computed({
  get: () => rejecting.value !== null,
  set: (v) => {
    if (!v && busyId.value === null) rejecting.value = null
  },
})
const comment = ref('')

const previewing = ref<ScheduleRequest | null>(null)

function workingDays(r: ScheduleRequest) {
  return r.days.filter((d) => d.working).map((d) => d.date)
}

function offDays(r: ScheduleRequest) {
  return r.days.filter((d) => !d.working).map((d) => d.date)
}

function errorMessage(result: Exclude<ScheduleRequestActionResult, { ok: true }>): string {
  if (result.error === 'conflict') return 'Заявку уже рассмотрели'
  if (result.error === 'not_found') return 'Заявка не найдена — возможно, ее отозвали'
  if (result.error === 'unavailable') return result.message
  return 'Не удалось сохранить решение'
}

async function decide(r: ScheduleRequest, approve: boolean) {
  if (busyId.value !== null) return
  busyId.value = r.id
  try {
    const result = approve
      ? await approveScheduleRequest(r.id)
      : await rejectScheduleRequest(r.id, { comment: comment.value.trim() || undefined })
    if (result.ok) {
      toast.success(approve ? 'Заявка одобрена, график обновлен' : 'Заявка отклонена')
      rejecting.value = null
      previewing.value = null
    } else {
      toast.error(errorMessage(result))
    }
    // И при успехе, и при конфликте список устарел; при одобрении поменялся и график.
    await Promise.all([
      queryCache.invalidateQueries({ key: SCHEDULE_REQUESTS_KEY }),
      approve ? queryCache.invalidateQueries({ key: SCHEDULE_KEY }) : undefined,
    ]).catch(() => {})
  } catch {
    toast.error('Не удалось сохранить решение')
  } finally {
    busyId.value = null
  }
}

function openReject(r: ScheduleRequest) {
  // У отказа свой диалог с комментарием; предпросмотр под ним только мешал бы.
  previewing.value = null
  comment.value = ''
  rejecting.value = r
}
</script>

<template>
  <section
    v-if="requests.length > 0"
    class="mb-4 grid max-w-2xl gap-2"
    aria-label="Заявки на согласование"
  >
    <h2 class="text-sm font-medium">Заявки на согласование: {{ requests.length }}</h2>
    <div
      v-for="r in requests"
      :key="r.id"
      class="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
    >
      <div class="grid min-w-0 gap-2 text-sm">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="font-semibold">{{ r.masterName }}</span>
          <span class="text-xs text-muted-foreground">{{ formatSentAt(r.createdAt) }}</span>
        </div>
        <div v-if="workingDays(r).length > 0" class="flex items-baseline gap-2">
          <span
            class="mt-1.5 size-2.5 shrink-0 self-start rounded-sm bg-primary"
            aria-hidden="true"
          />
          <p>
            <span class="text-muted-foreground">Рабочие:</span> {{ formatDayList(workingDays(r)) }}
          </p>
        </div>
        <div v-if="offDays(r).length > 0" class="flex items-baseline gap-2">
          <span
            class="mt-1.5 size-2.5 shrink-0 self-start rounded-sm border border-border"
            aria-hidden="true"
          />
          <p>
            <span class="text-muted-foreground">Выходные:</span> {{ formatDayList(offDays(r)) }}
          </p>
        </div>
        <Button
          variant="link"
          size="sm"
          class="h-10 w-fit px-0 text-muted-foreground hover:text-foreground sm:h-auto"
          :disabled="busyId !== null"
          :aria-label="`Предпросмотр заявки: ${r.masterName}`"
          @click="previewing = r"
        >
          <CalendarDays class="size-4" />
          Показать в календаре
        </Button>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
        <Button
          variant="outline"
          size="sm"
          class="h-10 sm:h-8"
          :disabled="busyId !== null"
          :aria-label="`Отклонить заявку: ${r.masterName}`"
          @click="openReject(r)"
        >
          Отклонить
        </Button>
        <Button
          size="sm"
          class="h-10 sm:h-8"
          :disabled="busyId !== null"
          :aria-label="`Одобрить заявку: ${r.masterName}`"
          @click="decide(r, true)"
        >
          Одобрить
        </Button>
      </div>
    </div>

    <ScheduleRequestPreviewDialog
      :request="previewing"
      :busy="busyId !== null"
      @close="previewing = null"
      @approve="decide($event, true)"
      @reject="openReject"
    />

    <Dialog v-model:open="rejectOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отклонить заявку</DialogTitle>
          <DialogDescription>{{ rejecting?.masterName }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4 py-2" @submit.prevent="rejecting && decide(rejecting, false)">
          <div class="grid gap-2">
            <Label for="schedule-reject-comment">
              Комментарий <span class="font-normal text-muted-foreground">(необязательно)</span>
            </Label>
            <Textarea
              id="schedule-reject-comment"
              v-model="comment"
              rows="2"
              class="[field-sizing:content]"
              maxlength="500"
              :disabled="busyId !== null"
            />
          </div>
          <DialogFooter class="gap-2">
            <Button
              type="button"
              variant="ghost"
              :disabled="busyId !== null"
              @click="rejectOpen = false"
            >
              Отмена
            </Button>
            <Button type="submit" variant="destructive" :disabled="busyId !== null">
              Отклонить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
