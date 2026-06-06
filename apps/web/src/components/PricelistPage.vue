<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchPricelist, type PricelistSection } from '@/lib/pricelist-api'

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

      <div v-if="loading" class="text-muted-foreground">Загрузка…</div>

      <div
        v-else-if="error"
        class="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {{ error }}
      </div>

      <div v-else-if="sections.length === 0" class="text-muted-foreground">
        Прайс-лист пуст.
      </div>

      <div v-else class="overflow-x-auto rounded-md border border-border">
        <table class="w-full text-sm">
          <colgroup>
            <col class="w-72" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="w-24" />
            <col class="w-24" />
            <col />
          </colgroup>
          <thead class="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th scope="col" class="px-4 py-2 font-medium">Услуга</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">I кл.</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">II кл.</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">III кл.</th>
              <th scope="col" class="px-4 py-2 text-right font-medium">IV кл.</th>
              <th scope="col" class="px-4 py-2 font-medium">Примечание</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="section in sections" :key="section.id">
              <tr class="border-t border-border bg-muted/30">
                <th
                  scope="colgroup"
                  colspan="6"
                  class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {{ section.name }}
                </th>
              </tr>
              <tr
                v-for="svc in section.services"
                :key="svc.id"
                class="border-t border-border align-top"
              >
                <td class="px-4 py-2 font-medium">{{ svc.name }}</td>
                <td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {{ formatPrice(svc.priceClass1) }}
                </td>
                <td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {{ formatPrice(svc.priceClass2) }}
                </td>
                <td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {{ formatPrice(svc.priceClass3) }}
                </td>
                <td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {{ formatPrice(svc.priceClass4) }}
                </td>
                <td class="px-4 py-2 text-xs text-muted-foreground whitespace-pre-line">
                  {{ svc.description || '' }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
