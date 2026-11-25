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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="text-foreground p-2 sm:p-8">
    <div class="mx-auto max-w-2xl">
      <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold">Уведомления</h1>
        <Button
          v-if="unreadCount > 0"
          size="sm"
          variant="outline"
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

      <div v-if="loading" class="flex flex-col gap-2">
        <Skeleton v-for="i in 4" :key="i" class="h-20" />
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
        <ul class="flex flex-col gap-2">
          <li v-for="n in items" :key="n.id">
            <button
              type="button"
              class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
              :class="n.readAt ? 'bg-background' : 'border-primary/40 bg-primary/5'"
              @click="open(n)"
            >
              <span
                class="mt-1.5 size-2 shrink-0 rounded-full"
                :class="n.readAt ? 'bg-transparent' : 'bg-primary'"
                aria-hidden="true"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span :class="n.readAt ? 'font-medium' : 'font-semibold'">{{ n.title }}</span>
                  <span class="text-xs text-muted-foreground">{{ formatWhen(n.createdAt) }}</span>
                </span>
                <span class="text-sm break-words text-muted-foreground">{{ n.body }}</span>
                <span v-if="!n.readAt" class="sr-only">Не прочитано</span>
              </span>
            </button>
          </li>
        </ul>
        <div v-if="hasMore" class="mt-4 flex justify-center">
          <Button variant="outline" size="sm" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? 'Загрузка…' : 'Показать еще' }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
