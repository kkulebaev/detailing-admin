<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { BOOKING_AUDIT_ACTIONS, type BookingJournalEntry } from '@detailing-admin/shared'
import { useAccountsQuery, useBookingJournalQuery } from '@/lib/queries'
import {
  AUDIT_ACTION_META,
  auditDayKey,
  auditDayLabel,
  formatAuditClock,
} from '@/lib/booking-audit'
import AuditEntryItem from './AuditEntryItem.vue'
import AuditEntrySkeleton from './AuditEntrySkeleton.vue'
import { isoToDdmmyyyy } from '@/lib/date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE = 50
// Совпадает с потолком `limit` у GET /api/bookings/journal.
const MAX_LIMIT = 500
// Select из reka-ui не принимает '', поэтому «все» держится на значении-маркере.
const ALL = '__all__'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const limit = ref(PAGE)
const actorFilter = ref(ALL)
const actionFilter = ref(ALL)

watch(
  () => props.open,
  (open) => {
    if (open) limit.value = PAGE
  },
)
// Новый фильтр — новая лента: подгруженные страницы старой к ней не относятся.
watch([actorFilter, actionFilter], () => (limit.value = PAGE))

const params = computed(() => ({
  limit: limit.value,
  actorId: actorFilter.value === ALL ? undefined : actorFilter.value,
  action: BOOKING_AUDIT_ACTIONS.find((a) => a === actionFilter.value),
}))

const open = toRef(props, 'open')
const { data, isPending, isPlaceholderData, error } = useBookingJournalQuery(open, params)
const { data: accountsData } = useAccountsQuery(open)

const accounts = computed(() => {
  const d = accountsData.value
  if (!d?.ok) return []
  return d.accounts
    .map((a) => ({
      id: a.id,
      label: [a.firstName, a.lastName].filter(Boolean).join(' ') || a.login,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
})

const items = computed(() => (data.value?.ok ? data.value.items : []))
const hasMore = computed(() => data.value?.ok === true && data.value.hasMore)
const failed = computed(() => error.value != null || (data.value != null && !data.value.ok))
const filtered = computed(() => actorFilter.value !== ALL || actionFilter.value !== ALL)

const groups = computed(() => {
  const out: { key: string; label: string; entries: BookingJournalEntry[] }[] = []
  for (const entry of items.value) {
    const key = auditDayKey(entry.at)
    const last = out[out.length - 1]
    if (last?.key === key) last.entries.push(entry)
    else out.push({ key, label: auditDayLabel(entry.at), entries: [entry] })
  }
  return out
})

function bookingTitle(entry: BookingJournalEntry): string {
  const b = entry.booking
  if (!b) return 'Запись'
  return [b.car, b.name.trim()].filter(Boolean).join(' · ') || 'Без машины'
}

function shortDate(iso: string): string {
  return isoToDdmmyyyy(iso).slice(0, 5)
}

function bookingWhen(entry: BookingJournalEntry): string {
  const b = entry.booking
  if (!b) return ''
  const date = b.dateTo ? `${shortDate(b.dateFrom)}–${shortDate(b.dateTo)}` : shortDate(b.dateFrom)
  return `запись на ${date}${b.timeFrom ? `, ${b.timeFrom}` : ''}`
}
</script>

<template>
  <Sheet :open="props.open" @update:open="(v) => emit('update:open', v)">
    <SheetContent class="w-full gap-0 sm:max-w-lg">
      <SheetHeader class="border-b">
        <SheetTitle>Журнал изменений</SheetTitle>
        <SheetDescription>Кто и что делал с записями</SheetDescription>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <Select v-model="actorFilter">
            <SelectTrigger
              class="w-full min-w-0 data-[size=default]:h-10 *:data-[slot=select-value]:block sm:data-[size=default]:h-8"
              aria-label="Сотрудник"
            >
              <SelectValue class="truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">Все сотрудники</SelectItem>
              <SelectItem v-for="a in accounts" :key="a.id" :value="a.id">{{ a.label }}</SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="actionFilter">
            <SelectTrigger
              class="w-full min-w-0 data-[size=default]:h-10 *:data-[slot=select-value]:block sm:data-[size=default]:h-8"
              aria-label="Действие"
            >
              <SelectValue class="truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL">Все действия</SelectItem>
              <SelectItem v-for="a in BOOKING_AUDIT_ACTIONS" :key="a" :value="a">
                {{ AUDIT_ACTION_META[a].label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SheetHeader>

      <div class="flex-1 overflow-y-auto px-4 pb-safe">
        <div v-if="isPending" class="pt-4">
          <Skeleton class="mb-4 h-3 w-16" />
          <div class="space-y-4">
            <AuditEntrySkeleton v-for="i in 4" :key="i" with-booking />
          </div>
        </div>
        <p v-else-if="failed" class="pt-4 text-sm text-destructive">Не удалось загрузить журнал</p>
        <p v-else-if="items.length === 0" class="pt-4 text-sm text-muted-foreground">
          {{ filtered ? 'Под эти фильтры событий нет' : 'Событий пока нет' }}
        </p>
        <template v-else>
          <section v-for="group in groups" :key="group.key">
            <h3
              class="sticky top-0 z-10 bg-background pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {{ group.label }}
            </h3>
            <ol class="space-y-4">
              <li v-for="entry in group.entries" :key="entry.id">
                <AuditEntryItem :entry="entry" :time="formatAuditClock(entry.at)">
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="break-words">{{ bookingTitle(entry) }}</span>
                    <Badge v-if="entry.deleted" variant="outline" class="text-destructive">
                      удалена
                    </Badge>
                  </div>
                  <div v-if="entry.booking" class="text-xs text-muted-foreground tabular-nums">
                    {{ bookingWhen(entry) }}
                  </div>
                </AuditEntryItem>
              </li>
            </ol>
          </section>
          <Button
            v-if="hasMore && limit < MAX_LIMIT"
            variant="outline"
            size="sm"
            class="mt-6 h-10 w-full sm:h-8"
            :disabled="isPlaceholderData"
            @click="limit = Math.min(limit + PAGE, MAX_LIMIT)"
          >
            {{ isPlaceholderData ? 'Загрузка…' : 'Показать еще' }}
          </Button>
        </template>
      </div>
    </SheetContent>
  </Sheet>
</template>
