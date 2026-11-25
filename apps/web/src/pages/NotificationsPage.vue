<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, CheckCheck } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '@/lib/notifications-api'
import { useInvalidateNotifications } from '@/lib/queries'
import NotificationItem from '@/components/NotificationItem.vue'
import { groupByDay } from '@/lib/notification-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

const router = useRouter()
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

// Прочитанным помечаем сразу и не ждем ответа: переход важнее, а сбой отметки
// лишь оставит уведомление непрочитанным до следующего захода.
async function open(n: Notification) {
  if (!n.readAt) {
    n.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
    void markNotificationRead(n.id)
      .catch(() => undefined)
      .finally(() => void invalidateNotifications())
  }
  if (n.link) await router.push(n.link)
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
              <NotificationItem :notification="n" @open="open(n)" />
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
  </div>
</template>
