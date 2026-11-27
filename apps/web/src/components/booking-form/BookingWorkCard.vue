<script setup lang="ts">
import { useFieldValue, useSetFieldValue } from 'vee-validate'
import { DEFAULT_CAR_CLASS, type CarClass } from '@detailing-admin/shared'
import type { ServiceBreakdownRow } from '@/lib/service-breakdown'
import { useShownErrors } from '@/composables/use-shown-errors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import ServicePicker from '../ServicePicker.vue'

const emit = defineEmits<{
  total: [total: number | null]
  breakdown: [rows: ServiceBreakdownRow[]]
}>()

const shownError = useShownErrors()
const carClass = useFieldValue<CarClass | undefined>('carClass')
const setCarClass = useSetFieldValue<CarClass>('carClass')
</script>

<template>
  <Card class="gap-4 py-4 shadow-none">
    <CardHeader class="px-4">
      <CardTitle class="text-base">Объем работ</CardTitle>
    </CardHeader>
    <CardContent class="px-4">
      <div class="space-y-4">
        <!-- Привязано явными пропсами вместо `v-bind="componentField"`:
           сквозные DOM-слушатели onInput/onChange из componentField
           попадают на корневой div пикера и перезаписывали бы `service`
           текстом любого всплывшего события (например, из полей цен). -->
        <FormField v-slot="{ value, handleChange }" name="service">
          <FormItem>
            <FormLabel>Услуга</FormLabel>
            <FormControl>
              <ServicePicker
                :model-value="typeof value === 'string' ? value : ''"
                :car-class="carClass ?? DEFAULT_CAR_CLASS"
                :invalid="!!shownError('service')"
                @update:model-value="handleChange"
                @update:car-class="(c: CarClass) => setCarClass(c)"
                @update:total="emit('total', $event)"
                @update:breakdown="emit('breakdown', $event)"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="note">
          <FormItem>
            <FormLabel>
              Примечание
              <span class="text-muted-foreground font-normal">(необязательно)</span>
            </FormLabel>
            <FormControl>
              <Textarea rows="3" class="[field-sizing:content]" v-bind="componentField" />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
      </div>
    </CardContent>
  </Card>
</template>
