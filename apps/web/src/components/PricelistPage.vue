<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchPricelist, type PricelistSection } from '@/lib/pricelist-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const sections = ref<PricelistSection[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const totalServices = computed(() =>
  sections.value.reduce((acc, s) => acc + s.services.length, 0),
)

const priceFormatter = new Intl.NumberFormat('ru-RU')

function formatPrice(value: number | null): string {
  if (value === null) return '—'
  return `${priceFormatter.format(value)} ₽`
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await fetchPricelist()
    if (result.ok) {
      sections.value = result.sections
    } else if (result.error === 'unavailable') {
      error.value = result.message || 'База данных недоступна'
    } else {
      error.value = 'Не удалось загрузить прайс-лист'
    }
  } catch {
    error.value = 'Сетевая ошибка при загрузке прайс-листа'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div class="mx-auto max-w-7xl">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold">Прайс-лист</h1>
        <p v-if="!loading && !error" class="mt-1 text-sm text-muted-foreground">
          Разделов: {{ sections.length }} · Услуг: {{ totalServices }}
        </p>
      </header>

      <Alert v-if="error" variant="destructive">
        <AlertTitle>Не удалось загрузить прайс-лист</AlertTitle>
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-else class="overflow-hidden rounded-md border border-border">
        <Table>
          <colgroup>
            <col class="w-72" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="w-24" />
            <col />
          </colgroup>
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="px-4">Услуга</TableHead>
              <TableHead class="px-4 text-right">I кл.</TableHead>
              <TableHead class="px-4 text-right">II кл.</TableHead>
              <TableHead class="px-4 text-right">III кл.</TableHead>
              <TableHead class="px-4 text-right">IV кл.</TableHead>
              <TableHead class="px-4">Примечание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="loading">
              <TableRow v-for="i in 6" :key="i">
                <TableCell class="px-4"><Skeleton class="h-4 w-48" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4 text-right"><Skeleton class="h-4 w-16 ml-auto" /></TableCell>
                <TableCell class="px-4"><Skeleton class="h-4 w-40" /></TableCell>
              </TableRow>
            </template>
            <TableEmpty v-else-if="sections.length === 0" :colspan="6">
              Прайс-лист пуст.
            </TableEmpty>
            <template v-else v-for="section in sections" :key="section.id">
              <TableRow class="bg-muted/30 hover:bg-muted/30">
                <TableHead
                  scope="colgroup"
                  colspan="6"
                  class="px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {{ section.name }}
                </TableHead>
              </TableRow>
              <TableRow
                v-for="svc in section.services"
                :key="svc.id"
                class="align-top"
              >
                <TableCell class="px-4 font-medium whitespace-normal">{{ svc.name }}</TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass1) }}
                </TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass2) }}
                </TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass3) }}
                </TableCell>
                <TableCell class="px-4 text-right tabular-nums">
                  {{ formatPrice(svc.priceClass4) }}
                </TableCell>
                <TableCell class="px-4 text-xs text-muted-foreground whitespace-pre-line">
                  {{ svc.description || '' }}
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>
</template>
