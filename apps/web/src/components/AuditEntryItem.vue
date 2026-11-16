<script setup lang="ts">
import { computed } from 'vue'
import type { BookingAuditEntry } from '@detailing-admin/shared'
import {
  AUDIT_ACTION_META,
  auditActor,
  auditFieldLabel,
  formatAuditValue,
  isEmptyAuditValue,
  visibleAuditChanges,
} from '@/lib/booking-audit'

// Одно событие журнала: общий вид для истории записи и для общего журнала, чтобы они
// не разъезжались. Слот — строки о самой записи, нужные только общему журналу.
const props = defineProps<{
  entry: Pick<BookingAuditEntry, 'action' | 'actorLogin' | 'actorName' | 'at' | 'changes'>
  time: string
}>()

const meta = computed(() => AUDIT_ACTION_META[props.entry.action])
const changes = computed(() => visibleAuditChanges(props.entry.changes))
const actor = computed(() => auditActor(props.entry))
</script>

<template>
  <div class="flex gap-3 text-sm">
    <span
      class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
      :class="meta.tone"
      :aria-label="meta.label"
    >
      <component :is="meta.icon" class="size-3.5" />
    </span>
    <div class="min-w-0 flex-1">
      <!-- Перенос вместо обрезки: на узком экране длинное время («10 ноября, 05:25»)
           уходит на свою строку, а не съедает действие до «изм…». -->
      <div class="flex flex-wrap items-baseline justify-between gap-x-2">
        <div class="min-w-0 break-words">
          <template v-if="actor">
            <span class="font-medium">{{ actor }}</span>
            <span class="text-muted-foreground"> · {{ meta.noun }}</span>
          </template>
          <span v-else class="font-medium">{{ meta.label }}</span>
        </div>
        <time
          class="shrink-0 text-xs text-muted-foreground tabular-nums"
          :datetime="props.entry.at"
        >
          {{ props.time }}
        </time>
      </div>
      <slot />
      <!-- Подпись по ширине самой длинной: в трети ширины на телефоне «Ответственный»
           налезал на значение. -->
      <dl
        v-if="changes.length"
        class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2"
      >
        <template v-for="change in changes" :key="change.field">
          <dt class="text-muted-foreground">{{ auditFieldLabel(change.field) }}</dt>
          <dd class="min-w-0 break-words">
            <template v-if="!isEmptyAuditValue(change.from)">
              <span class="text-muted-foreground line-through decoration-muted-foreground/60">
                {{ formatAuditValue(change.field, change.from) }}
              </span>
              <span class="text-muted-foreground"> → </span>
            </template>
            <span :class="isEmptyAuditValue(change.to) && 'text-muted-foreground'">
              {{
                isEmptyAuditValue(change.to) ? 'пусто' : formatAuditValue(change.field, change.to)
              }}
            </span>
          </dd>
        </template>
      </dl>
    </div>
  </div>
</template>
