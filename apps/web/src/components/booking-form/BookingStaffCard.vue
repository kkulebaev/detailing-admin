<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { MAX_MASTERS } from '@detailing-admin/shared'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import MasterMultiSelect from '../MasterMultiSelect.vue'

defineProps<{
  masterOptions: string[]
  responsibleOptions: string[]
  mastersWarning: string | null
  daysOff: string[]
}>()
</script>

<template>
  <Card class="gap-4 py-4 shadow-none">
    <CardHeader class="px-4">
      <CardTitle class="text-base">Статус</CardTitle>
    </CardHeader>
    <CardContent class="px-4">
      <div class="space-y-4">
        <Alert v-if="mastersWarning" variant="destructive">
          <AlertDescription>{{ mastersWarning }}</AlertDescription>
        </Alert>
        <FormField v-slot="{ componentField }" name="master">
          <FormItem>
            <FormLabel>Мастер</FormLabel>
            <!-- Без FormControl: его атрибуты id/aria-* рассчитаны прямо на
               обернутый элемент, а настоящая кнопка здесь спрятана за
               слоями Popover/PopoverTrigger (как и в случае ServicePicker,
               сквозные атрибуты componentField — не простой input). -->
            <MasterMultiSelect
              v-bind="componentField"
              :options="masterOptions"
              :max="MAX_MASTERS"
              class="min-h-11"
            />
            <FormMessage />
            <Alert v-if="daysOff.length > 0" variant="destructive">
              <TriangleAlert />
              <AlertTitle>Выходной по графику</AlertTitle>
              <AlertDescription>
                <p v-for="line in daysOff" :key="line">{{ line }}</p>
              </AlertDescription>
            </Alert>
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="responsible">
          <FormItem>
            <FormLabel>Ответственный</FormLabel>
            <Select v-bind="componentField">
              <FormControl>
                <SelectTrigger class="h-11">
                  <SelectValue placeholder="Не выбрано" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem v-for="r in responsibleOptions" :key="r" :value="r">
                  {{ r }}
                </SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        </FormField>
      </div>
    </CardContent>
  </Card>
</template>
