<script setup lang="ts">
import { computed } from 'vue'
import type { Notification } from '@/lib/notifications-api'
import { formatDateTime, notificationVisual } from '@/lib/notification-view'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const props = defineProps<{ open: boolean; notification: Notification | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const visual = computed(() => (props.notification ? notificationVisual(props.notification) : null))

// Иначе reka-ui фокусирует крестик, и диалог открывается с кольцом фокуса на нем.
function focusDialogItself(e: Event) {
  e.preventDefault()
  if (e.target instanceof HTMLElement) e.target.focus()
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent
      v-if="props.notification && visual"
      class="max-h-svh max-w-md overflow-y-auto pb-safe sm:pb-6"
      @open-auto-focus="focusDialogItself"
    >
      <DialogHeader class="flex-row items-start gap-3 text-left">
        <span
          :class="cn('flex size-10 shrink-0 items-center justify-center rounded-full', visual.tone)"
          aria-hidden="true"
        >
          <component :is="visual.icon" class="size-5" />
        </span>
        <div class="flex min-w-0 flex-col gap-1">
          <DialogTitle class="leading-snug break-words">
            {{ props.notification.title }}
          </DialogTitle>
          <DialogDescription>
            {{ visual.label }} ·
            <time :datetime="props.notification.createdAt">
              {{ formatDateTime(props.notification.createdAt) }}
            </time>
          </DialogDescription>
        </div>
      </DialogHeader>

      <p class="text-sm leading-relaxed break-words whitespace-pre-line">
        {{ props.notification.body }}
      </p>
    </DialogContent>
  </Dialog>
</template>
