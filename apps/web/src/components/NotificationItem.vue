<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from '@lucide/vue'
import type { Notification } from '@/lib/notifications-api'
import { formatTime, notificationVisual } from '@/lib/notification-view'
import { cn } from '@/lib/utils'

const props = defineProps<{ notification: Notification }>()
defineEmits<{ open: [] }>()

const visual = computed(() => notificationVisual(props.notification))
const unread = computed(() => !props.notification.readAt)
</script>

<template>
  <button
    type="button"
    class="hover:bg-accent/60 focus-visible:ring-ring relative flex min-h-18 w-full items-start gap-3 py-3 pr-3 pl-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    @click="$emit('open')"
  >
    <span
      v-if="unread"
      class="bg-primary absolute inset-y-0 left-0 w-1 rounded-r-full"
      aria-hidden="true"
    />
    <span
      :class="
        cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          visual.tone,
          !unread && 'opacity-70',
        )
      "
      aria-hidden="true"
    >
      <component :is="visual.icon" class="size-5" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex items-baseline justify-between gap-3">
        <span
          :class="
            cn(
              'line-clamp-2 text-sm leading-snug break-words',
              unread ? 'font-semibold' : 'font-medium',
            )
          "
        >
          {{ notification.title }}
        </span>
        <time
          :datetime="notification.createdAt"
          :class="
            cn(
              'shrink-0 text-xs tabular-nums',
              unread ? 'text-foreground font-medium' : 'text-muted-foreground',
            )
          "
        >
          {{ formatTime(notification.createdAt) }}
        </time>
      </span>
      <span class="text-muted-foreground line-clamp-3 text-sm leading-snug break-words">
        {{ notification.body }}
      </span>
      <span v-if="unread" class="sr-only">Не прочитано</span>
    </span>
    <ChevronRight
      v-if="notification.link"
      class="text-muted-foreground/50 mt-2.5 hidden size-4 shrink-0 sm:block"
      aria-hidden="true"
    />
  </button>
</template>
