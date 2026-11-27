<script setup lang="ts">
import { Pencil } from '@lucide/vue'
import { formatAmount } from '@/lib/money'
import { AMOUNT_PRESETS, type BookingAmount } from '@/composables/use-booking-amount'
import type { Discount } from '@/composables/use-discount'
import { useShownErrors } from '@/composables/use-shown-errors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const props = defineProps<{ amount: BookingAmount; discount: Discount }>()
// Объекты из composable не меняются за время жизни формы, поэтому их можно разобрать один раз.
const {
  amountRaw,
  amountOverridden,
  amountDeltaLabel,
  resetAmountToServices,
  onAmountInput,
  addAmount,
} = props.amount
const {
  raw: discountRaw,
  unit: discountUnit,
  amount: discountAmount,
  finalAmount,
  hasDiscount,
  onInput: onDiscountInput,
  setUnit: setDiscountUnit,
} = props.discount

const shownError = useShownErrors()
</script>

<template>
  <Card class="gap-4 py-4 shadow-none">
    <CardHeader class="px-4">
      <CardTitle class="text-base">Оплата</CardTitle>
    </CardHeader>
    <CardContent class="px-4">
      <Label class="mb-2 block">Сумма, ₽</Label>
      <Input
        type="text"
        inputmode="numeric"
        class="h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        placeholder="0"
        v-model="amountRaw"
        :aria-invalid="!!shownError('amount')"
        @input="onAmountInput"
      />
      <div class="flex flex-wrap gap-2 mt-2">
        <button
          v-for="delta in AMOUNT_PRESETS"
          :key="delta"
          type="button"
          class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors"
          @click="addAmount(delta)"
        >
          +{{ formatAmount(delta) }}
        </button>
      </div>
      <p
        v-if="amountOverridden"
        class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-600 dark:text-amber-500"
      >
        <Pencil class="size-3.5 shrink-0" />
        <span>Изменено вручную · {{ amountDeltaLabel }}</span>
        <button
          type="button"
          class="underline underline-offset-2 hover:no-underline"
          @click="resetAmountToServices"
        >
          вернуть
        </button>
      </p>
      <p v-if="amountOverridden" class="mt-1 text-xs text-muted-foreground">
        При изменении услуг, их цен или класса кузова сумма пересчитается автоматически.
      </p>
      <p v-if="shownError('amount')" class="text-sm font-medium text-destructive mt-1">
        {{ shownError('amount') }}
      </p>

      <Label class="mt-4 mb-2 block">
        Скидка
        <span class="text-muted-foreground font-normal">(необязательно)</span>
      </Label>
      <div class="flex gap-2">
        <div
          class="inline-flex h-11 items-center rounded-md border border-input bg-background p-1 shrink-0"
        >
          <button
            type="button"
            :data-active="discountUnit === 'rub'"
            class="h-full px-3 rounded-sm text-sm transition-colors hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            @click="setDiscountUnit('rub')"
          >
            ₽
          </button>
          <button
            type="button"
            :data-active="discountUnit === 'pct'"
            class="h-full px-3 rounded-sm text-sm transition-colors hover:bg-accent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            @click="setDiscountUnit('pct')"
          >
            %
          </button>
        </div>
        <div class="relative flex-1">
          <Input
            type="text"
            inputmode="numeric"
            class="h-11 pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder="0"
            :model-value="discountRaw"
            @input="onDiscountInput"
          />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {{ discountUnit === 'pct' ? '%' : '₽' }}
          </span>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span class="text-sm text-muted-foreground">Итого к оплате</span>
        <span class="tabular-nums font-semibold">
          {{ formatAmount(finalAmount) }} ₽
          <span v-if="hasDiscount" class="ml-1 text-xs font-normal text-muted-foreground">
            (−{{ formatAmount(discountAmount) }} ₽)
          </span>
        </span>
      </div>
    </CardContent>
  </Card>
</template>
