<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClipboard } from '@vueuse/core'
import { Copy } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookingRow, Car } from '@detailing-admin/shared'
import { formatPhone } from '@/lib/phone'
import { useClientDetailQuery } from '@/lib/queries'
import { readinessBadgeClass } from '@/lib/readiness'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{ open: boolean; clientId: string | null }>()
// Эмитится ради совместимости с v-model; родитель управляет `open` из маршрута, поэтому
// навигацию при закрытии этот компонент делает сам (см. `close`).
const emit = defineEmits<{ 'update:open': [boolean] }>()

const router = useRouter()

const clientIdRef = computed(() => props.clientId)
const {
  data: queryData,
  error: queryError,
  asyncStatus,
  refetch,
} = useClientDetailQuery(clientIdRef)

// Плитки и историю питает только payload с ok:true — устаревшая прямая ссылка,
// которая вернула not_found/unavailable, никогда не протечет в них undefined.
const detail = computed(() => {
  const r = queryData.value
  return r && r.ok ? r : null
})

const notFound = computed(() => {
  const r = queryData.value
  return !!r && !r.ok && r.error === 'not_found'
})

const errorMessage = computed<string | null>(() => {
  if (queryError.value) return 'Сетевая ошибка при загрузке карточки'
  const r = queryData.value
  if (!r || r.ok || r.error === 'not_found') return null
  if (r.error === 'unavailable') return r.message || 'База данных недоступна'
  return 'Не удалось загрузить карточку клиента'
})

// Скелетоны только при самой первой загрузке конкретного клиента (данных еще нет).
const isLoading = computed(
  () => asyncStatus.value === 'loading' && queryData.value === undefined && !queryError.value,
)

// ── Ожидание анимации появления ──────────────────────────────────────────────
// Диалог проявляется/увеличивается за `duration-200`. На localhost запрос часто
// завершается внутри этого окна; замена скелетон→детали (машины + 3 плитки + N
// карточек записей) посреди анимации вызывает тяжелый layout/paint на анимируемом
// слое. Придерживаем замену контента до конца появления, чтобы она пришлась на
// свободный кадр; под анимацией вместо этого анимируется дешевый скелетон.
const entranceDone = ref(false)
let entranceTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.open,
  (isOpen) => {
    clearTimeout(entranceTimer)
    if (!isOpen) return
    entranceDone.value = false
    entranceTimer = setTimeout(() => (entranceDone.value = true), 200)
  },
  { immediate: true },
)
onUnmounted(() => clearTimeout(entranceTimer))

const showSkeleton = computed(
  () => isLoading.value || (detail.value !== null && !entranceDone.value),
)

// ── Навигация при закрытии ──────────────────────────────────────────────────
// Если предыдущая запись истории — список, делаем шаг назад (чтобы браузерное
// «назад» не открыло диалог снова); при прямой ссылке вместо этого пушим список.
function close() {
  const back = router.options.history.state.back
  if (typeof back === 'string' && (back === '/clients' || back.startsWith('/clients?'))) {
    router.back()
  } else {
    router.push({ name: 'clients' })
  }
}

function onOpenChange(value: boolean) {
  emit('update:open', value)
  if (!value) close()
}

// ── Шапка ─────────────────────────────────────────────────────────────────
const { copy, isSupported: clipboardSupported } = useClipboard({ legacy: true })

async function copyPhone(phone: string) {
  const formatted = formatPhone(phone)
  if (!clipboardSupported.value) {
    toast.error('Копирование недоступно в этом браузере')
    return
  }
  try {
    await copy(formatted)
    toast.success('Телефон скопирован', { description: formatted })
  } catch {
    toast.error('Не удалось скопировать телефон')
  }
}

function formatCar(car: Car): string {
  return car.plate ? `${car.makeModel} (${car.plate})` : car.makeModel
}

// ── Форматирование ──────────────────────────────────────────────────────────
// Даты из БД приходят как ISO `YYYY-MM-DD`; на экране — DD.MM.YYYY.
function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

function formatBookingDate(row: BookingRow): string {
  const from = isoToDdmmyyyy(row.dateFrom)
  return row.dateTo ? `${from} – ${isoToDdmmyyyy(row.dateTo)}` : from
}

function formatAmount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

const displayName = computed(() => {
  const c = detail.value?.client
  if (!c) return ''
  return c.name || '— без имени'
})
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <!-- Модалка фиксированной высоты, НЕ DialogScrollContent: scroll-content-вариант
         центрирует карточку в прокручиваемом оверлее, и у истории выше экрана
         обрезается верх (place-items-center + overflow) без возможности до него
         докрутить. Вместо этого ограничиваем карточку высотой экрана (100dvh учитывает
         адресную строку мобильного браузера) и прокручиваем ВСЮ карточку — вместе
         с шапкой, без закрепления, — чтобы ничего не уезжало за экран. Ширина/поля
         берутся из умолчаний DialogContent (w-full · max-w-[calc(100%-2rem)] · sm:max-w-lg);
         здесь только переопределения высоты/прокрутки/отступов (скобки в max-h: утилиты
         для max-height на основе dvh нет). -->
    <DialogContent class="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0">
      <DialogHeader class="border-b border-border p-4 text-left">
        <DialogTitle>{{ detail ? displayName : 'Клиент' }}</DialogTitle>
        <DialogDescription v-if="detail" as="div" class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            class="-ml-2 gap-1 tabular-nums"
            :aria-label="`Скопировать телефон ${formatPhone(detail.client.phone)}`"
            :title="`Скопировать ${formatPhone(detail.client.phone)}`"
            @click="copyPhone(detail.client.phone)"
          >
            {{ formatPhone(detail.client.phone) }}
            <Copy class="size-3.5" />
          </Button>
        </DialogDescription>
        <DialogDescription v-else>Карточка клиента</DialogDescription>
      </DialogHeader>

      <!-- Body группирует ветки состояний; единственная прокрутка — у DialogContent выше,
           поэтому здесь простой блок (без вложенной прокрутки). -->
      <div>
        <!-- Ошибка (503 / сеть): можно повторить. -->
        <div v-if="errorMessage" class="p-4">
          <Alert variant="destructive">
            <AlertTitle>Не удалось загрузить карточку</AlertTitle>
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" class="mt-3" @click="refetch()">Повторить</Button>
        </div>

        <!-- Не найден (устаревшая закладка / клиент удален между загрузкой списка и кликом). -->
        <div v-else-if="notFound" class="p-4">
          <Alert>
            <AlertTitle>Клиент не найден</AlertTitle>
            <AlertDescription>
              Возможно, он был удален. Вернитесь к списку клиентов.
            </AlertDescription>
          </Alert>
          <Button variant="outline" size="sm" class="mt-3" @click="close">К списку клиентов</Button>
        </div>

        <!-- Загрузка: скелетоны плиток + истории. Также покрывает короткое окно
           после прихода данных, но до конца анимации появления. -->
        <div v-else-if="showSkeleton" class="space-y-6 p-4">
          <div class="grid grid-cols-2 gap-3">
            <Skeleton v-for="i in 2" :key="i" class="h-20 w-full" />
          </div>
          <div class="space-y-3">
            <Skeleton v-for="i in 4" :key="i" class="h-16 w-full" />
          </div>
        </div>

        <!-- Контент. -->
        <div v-else-if="detail" class="space-y-6 p-4">
          <!-- Машины -->
          <section>
            <h3 class="mb-2 text-sm font-medium text-muted-foreground">Машины</h3>
            <p v-if="detail.client.cars.length === 0" class="text-sm text-muted-foreground">
              Нет машин
            </p>
            <ul v-else class="space-y-1 text-sm">
              <li v-for="car in detail.client.cars" :key="car.id">{{ formatCar(car) }}</li>
            </ul>
          </section>

          <!-- Плитки статистики. «Выручка» — сумма «Выдана» за все время (реально
             заработанные деньги) — подписана «за все время», чтобы отличать ее от
             выручки за период на странице аналитики; «Количество записей»
             считает показанные строки истории (все статусы), поэтому совпадает со списком
             ниже, а не с visitCount только по выданным. Два коротких числа стоят
             рядом даже на самом узком телефоне (как на AnalyticsPage). -->
          <section class="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader class="p-3">
                <CardDescription class="text-sm">Выручка за все время</CardDescription>
                <CardTitle class="text-xl tabular-nums">
                  {{ formatAmount(detail.stats.totalSpent) }} ₽
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader class="p-3">
                <CardDescription class="text-sm">Количество записей</CardDescription>
                <CardTitle class="text-xl tabular-nums">{{ detail.bookings.length }}</CardTitle>
              </CardHeader>
            </Card>
          </section>

          <!-- История (все статусы) -->
          <section>
            <div class="mb-2 flex items-baseline justify-between">
              <h3 class="text-sm font-medium text-muted-foreground">История</h3>
              <span v-if="detail.bookingsTruncated" class="text-xs text-muted-foreground">
                показаны последние {{ detail.bookings.length }}
              </span>
            </div>

            <p
              v-if="detail.bookings.length === 0"
              class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
            >
              Нет записей
            </p>
            <ul v-else class="space-y-2">
              <li
                v-for="row in detail.bookings"
                :key="row.id"
                class="rounded-md border border-border p-3 text-sm"
              >
                <div class="flex items-start justify-between gap-2">
                  <span class="tabular-nums font-medium">{{ formatBookingDate(row) }}</span>
                  <Badge variant="secondary" :class="readinessBadgeClass(row.readiness)">
                    {{ row.readiness || 'нет статуса' }}
                  </Badge>
                </div>
                <p v-if="row.service" class="mt-1 whitespace-pre-line leading-snug">
                  {{ row.service }}
                </p>
                <div class="mt-1 flex items-start justify-between gap-2 text-muted-foreground">
                  <span>{{ row.master.length ? row.master.join(', ') : '—' }}</span>
                  <span v-if="row.amount != null" class="tabular-nums whitespace-nowrap">
                    {{ formatAmount(row.amount) }} ₽
                  </span>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
