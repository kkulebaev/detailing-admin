<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { Mail, MailOpen } from '@lucide/vue'
import type { Notification } from '@/lib/notifications-api'
import { formatTime, notificationVisual } from '@/lib/notification-view'
import { cn } from '@/lib/utils'

const props = defineProps<{ notification: Notification; swiped: boolean }>()
const emit = defineEmits<{ open: []; toggle: []; 'update:swiped': [value: boolean] }>()

const visual = computed(() => notificationVisual(props.notification))
const unread = computed(() => !props.notification.readAt)
const actionLabel = computed(
  () =>
    `${unread.value ? 'Отметить прочитанным' : 'Отметить непрочитанным'}: ${props.notification.title}`,
)

// Сдвиг, после которого жест считается горизонтальным; до него он может уйти в скролл.
const SWIPE_SLOP_PX = 8
// Доля ширины строки, после которой отпускание сразу выполняет действие, как в «Почте».
const FULL_SWIPE_RATIO = 0.6
const ACTION_FALLBACK_PX = 96

const actionEl = useTemplateRef<HTMLElement>('action')
const surfaceEl = useTemplateRef<HTMLElement>('surface')
const dragOffset = ref(0)
const dragging = ref(false)

interface Gesture {
  pointerId: number
  x: number
  y: number
  start: number
  rowWidth: number
  actionWidth: number
  mode: 'pending' | 'swipe' | 'scroll'
}
let gesture: Gesture | null = null
// После свайпа браузер может прислать click; он не должен открыть диалог. Флаг
// сбрасывается на следующем pointerdown, а не по таймеру: click приходит не всегда.
let suppressClick = false

const actionWidth = () => actionEl.value?.offsetWidth || ACTION_FALLBACK_PX
const translate = computed(() =>
  dragging.value ? dragOffset.value : props.swiped ? -actionWidth() : 0,
)

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  suppressClick = false
  const width = actionWidth()
  gesture = {
    pointerId: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    start: props.swiped ? -width : 0,
    rowWidth: surfaceEl.value?.offsetWidth ?? 0,
    actionWidth: width,
    mode: 'pending',
  }
}

function onPointerMove(e: PointerEvent) {
  const g = gesture
  if (!g || e.pointerId !== g.pointerId || g.mode === 'scroll') return
  const dx = e.clientX - g.x
  const dy = e.clientY - g.y
  if (g.mode === 'pending') {
    if (Math.abs(dx) > SWIPE_SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
      g.mode = 'swipe'
      dragging.value = true
      // Захват только для горизонтального жеста: при захвате на тапе click ушел бы
      // захватившему контейнеру, а не кнопке строки.
      try {
        surfaceEl.value?.setPointerCapture(e.pointerId)
      } catch {
        // Синтетический или уже отпущенный указатель захватить нельзя; жест идет и так.
      }
    } else if (Math.abs(dy) > SWIPE_SLOP_PX) {
      g.mode = 'scroll'
      return
    } else {
      return
    }
  }
  dragOffset.value = Math.min(0, Math.max(-g.rowWidth, g.start + dx))
}

function onPointerUp(e: PointerEvent) {
  const g = gesture
  if (!g || e.pointerId !== g.pointerId) return
  gesture = null
  if (g.mode === 'swipe') {
    dragging.value = false
    suppressClick = true
    const shift = -dragOffset.value
    if (shift >= g.rowWidth * FULL_SWIPE_RATIO) {
      emit('update:swiped', false)
      emit('toggle')
    } else {
      emit('update:swiped', shift > g.actionWidth / 2)
    }
  } else if (g.mode === 'pending' && g.start !== 0) {
    // Тап по открытой строке только закрывает действие.
    suppressClick = true
    emit('update:swiped', false)
  }
}

function onPointerCancel(e: PointerEvent) {
  const g = gesture
  if (!g || e.pointerId !== g.pointerId) return
  gesture = null
  if (g.mode !== 'swipe') return
  dragging.value = false
  emit('update:swiped', -dragOffset.value > g.actionWidth / 2)
}

function onRowClick(e: MouseEvent) {
  // detail 0 — click с клавиатуры: к жесту он отношения не имеет.
  if (suppressClick && e.detail !== 0) {
    suppressClick = false
    return
  }
  emit('open')
}

function runAction() {
  emit('update:swiped', false)
  emit('toggle')
}
</script>

<!-- Основная область, действие за ней и запасная кнопка для клавиатуры — соседи:
     кнопка внутри кнопки — невалидный HTML. -->
<template>
  <div
    class="relative overflow-hidden"
    :data-notification-row="notification.id"
    :data-swiped="swiped ? 'true' : undefined"
  >
    <!-- Только для пальца и мыши; клавиатура и скринридер идут через кнопку ниже. -->
    <button
      ref="action"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      data-swipe-action
      class="bg-primary text-primary-foreground absolute inset-y-0 right-0 flex w-24 flex-col items-center justify-center gap-1 text-xs font-medium"
      @click="runAction"
    >
      <MailOpen v-if="unread" class="size-5" />
      <Mail v-else class="size-5" />
      {{ unread ? 'Прочитано' : 'Не прочитано' }}
    </button>
    <div
      ref="surface"
      :class="
        cn(
          'bg-card relative touch-pan-y',
          !dragging && 'transition-transform duration-200 ease-out motion-reduce:transition-none',
        )
      "
      :style="{ transform: `translateX(${translate}px)` }"
      data-swipe-surface
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <span
        v-if="unread"
        class="bg-primary absolute inset-y-0 left-0 z-10 w-1 rounded-r-full"
        aria-hidden="true"
      />
      <button
        type="button"
        class="hover:bg-accent/60 focus-visible:ring-ring flex min-h-18 w-full items-start gap-3 py-3 pr-3 pl-4 text-left transition-colors select-none focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        aria-haspopup="dialog"
        @click="onRowClick"
      >
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
      </button>
    </div>
    <!-- sr-only уже absolute; на фокусе с клавиатуры кнопка просто раскрывается поверх
         строки справа. -->
    <button
      type="button"
      class="bg-primary text-primary-foreground sr-only z-20 rounded-md text-xs font-medium focus-visible:top-1/2 focus-visible:right-2 focus-visible:m-0 focus-visible:h-auto focus-visible:w-auto focus-visible:-translate-y-1/2 focus-visible:overflow-visible focus-visible:px-3 focus-visible:py-2 focus-visible:[clip:auto]"
      :aria-label="actionLabel"
      @click="emit('toggle')"
    >
      {{ unread ? 'Прочитано' : 'Не прочитано' }}
    </button>
  </div>
</template>
