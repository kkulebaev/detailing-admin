<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Bell, CheckCheck } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  type Notification,
} from '@/lib/notifications-api'
import { useInvalidateNotifications } from '@/lib/queries'
import NotificationDialog from '@/components/NotificationDialog.vue'
import NotificationItem from '@/components/NotificationItem.vue'
import { groupByDay } from '@/lib/notification-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

const invalidateNotifications = useInvalidateNotifications()

const items = ref<Notification[]>([])
const hasMore = ref(false)
const unreadCount = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const markingAll = ref(false)
const errorMessage = ref<string | null>(null)

// Лента растет курсором (id последнего показанного): свежее уведомление между
// запросами не сдвигает страницы и не дает дубль на стыке.
async function load(before?: number) {
  const result = await fetchNotifications(before === undefined ? {} : { before })
  if (!result.ok) {
    errorMessage.value =
      result.error === 'unavailable'
        ? result.message || 'База данных недоступна'
        : 'Не удалось загрузить уведомления'
    return
  }
  errorMessage.value = null
  items.value = before === undefined ? result.items : [...items.value, ...result.items]
  hasMore.value = result.hasMore
  unreadCount.value = result.unreadCount
}

onMounted(async () => {
  try {
    await load()
  } catch {
    errorMessage.value = 'Сетевая ошибка при загрузке уведомлений'
  } finally {
    loading.value = false
  }
})

async function loadMore() {
  const last = items.value[items.value.length - 1]
  if (!last || loadingMore.value) return
  loadingMore.value = true
  try {
    await load(last.id)
  } catch {
    toast.error('Не удалось загрузить уведомления')
  } finally {
    loadingMore.value = false
  }
}

function setRead(n: Notification, readAt: string | null) {
  if (Boolean(n.readAt) === Boolean(readAt)) return
  n.readAt = readAt
  unreadCount.value = Math.max(0, unreadCount.value + (readAt ? -1 : 1))
}

// Отметка видна сразу, ответа не ждем. Откатываем, только если отметку с тех пор не
// поменяли еще раз: иначе сбой старого запроса затер бы более свежий выбор.
async function mark(n: Notification, readAt: string | null) {
  const before = n.readAt
  setRead(n, readAt)
  let ok = false
  try {
    ok = (await (readAt ? markNotificationRead(n.id) : markNotificationUnread(n.id))).ok
  } catch {
    ok = false
  }
  if (!ok && n.readAt === readAt) {
    setRead(n, before)
    toast.error('Не удалось изменить отметку уведомления')
  }
  await invalidateNotifications()
}

const selected = ref<Notification | null>(null)
const dialogOpen = ref(false)

function open(n: Notification) {
  selected.value = n
  dialogOpen.value = true
  if (!n.readAt) void mark(n, new Date().toISOString())
}

// Открыт не больше одного свайпа; касание где угодно вне его строки (в том числе свайп
// другой строки) его закрывает.
const swipedId = ref<number | null>(null)

function setSwiped(id: number, value: boolean) {
  if (value) swipedId.value = id
  else if (swipedId.value === id) swipedId.value = null
}

useEventListener(
  document,
  'pointerdown',
  (e: PointerEvent) => {
    if (swipedId.value === null) return
    const row = e.target instanceof Element ? e.target.closest('[data-notification-row]') : null
    if (row?.getAttribute('data-notification-row') !== String(swipedId.value)) {
      swipedId.value = null
    }
  },
  { capture: true },
)

function toggle(n: Notification) {
  void mark(n, n.readAt ? null : new Date().toISOString())
}

async function readAll() {
  if (markingAll.value) return
  markingAll.value = true
  try {
    const result = await markAllNotificationsRead()
    if (!result.ok) {
      toast.error('Не удалось отметить уведомления')
      return
    }
    const now = new Date().toISOString()
    items.value = items.value.map((n) => (n.readAt ? n : { ...n, readAt: now }))
    unreadCount.value = 0
    await invalidateNotifications()
  } catch {
    toast.error('Не удалось отметить уведомления')
  } finally {
    markingAll.value = false
  }
}

const isEmpty = computed(() => !loading.value && !errorMessage.value && items.value.length === 0)

const days = computed(() => groupByDay(items.value))
</script>

<template>
  <div class="text-foreground p-2 sm:p-8">
    <div class="mx-auto max-w-2xl">
      <header class="mb-4 flex items-center justify-between gap-3 px-2 sm:mb-6 sm:px-0">
        <h1 class="text-2xl font-semibold">Уведомления</h1>
        <Button
          v-if="unreadCount > 0"
          size="sm"
          variant="ghost"
          class="text-primary"
          :disabled="markingAll"
          @click="readAll"
        >
          <CheckCheck class="size-4" /> Прочитать все
        </Button>
      </header>

      <Alert v-if="errorMessage" variant="destructive" class="mb-4">
        <AlertTitle>Ошибка</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div
        v-if="loading"
        class="bg-card divide-y overflow-hidden rounded-xl border"
        aria-hidden="true"
      >
        <div v-for="i in 5" :key="i" class="flex items-start gap-3 py-3 pr-3 pl-4">
          <Skeleton class="size-10 shrink-0 rounded-full" />
          <div class="flex flex-1 flex-col gap-2">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3.5 w-full" />
          </div>
        </div>
      </div>

      <Empty v-else-if="isEmpty" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bell />
          </EmptyMedia>
          <EmptyTitle>Уведомлений нет</EmptyTitle>
          <EmptyDescription>
            Здесь появятся записи, на которые вас назначили, решения по графику и выплаты
          </EmptyDescription>
        </EmptyHeader>
      </Empty>

      <template v-else>
        <section v-for="day in days" :key="day.key" class="mb-5 last:mb-0">
          <h2
            class="text-muted-foreground mb-1.5 px-2 text-xs font-medium tracking-wide uppercase sm:px-1"
          >
            {{ day.label }}
          </h2>
          <ul class="bg-card divide-y overflow-hidden rounded-xl border">
            <li v-for="n in day.items" :key="n.id">
              <NotificationItem
                :notification="n"
                :swiped="swipedId === n.id"
                @update:swiped="(v) => setSwiped(n.id, v)"
                @open="open(n)"
                @toggle="toggle(n)"
              />
            </li>
          </ul>
        </section>
        <div v-if="hasMore" class="mt-4 flex justify-center">
          <Button variant="outline" size="sm" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? 'Загрузка…' : 'Показать еще' }}
          </Button>
        </div>
      </template>
    </div>
    <NotificationDialog v-model:open="dialogOpen" :notification="selected" />
  </div>
</template>
