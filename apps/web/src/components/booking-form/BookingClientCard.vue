<script setup lang="ts">
import { useFieldValue, useSetFieldValue } from 'vee-validate'
import { TriangleAlert, User } from '@lucide/vue'
import type { ClientLookupSummary, MissedBookings } from '@detailing-admin/shared'
import type { Car, Client } from '@/lib/clients-api'
import { useAuthStore } from '@/stores/auth'
import { isoToDdmmyyyy } from '@/lib/date'
import { formatAmount } from '@/lib/money'
import { maskLicensePlate } from '@/lib/license-plate'
import { isComposingInput, maskCar, maskName, writeMasked } from '@/lib/input-masks'
import type { usePhoneInput } from '@/composables/use-phone-input'
import { useCarSuggestions } from '@/composables/use-car-suggestions'
import { useShownErrors } from '@/composables/use-shown-errors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

const props = defineProps<{
  phone: ReturnType<typeof usePhoneInput>
  matchedClient: Client | null
  matchedClientSummary: ClientLookupSummary | null
  showLookupSpinner: boolean
}>()
// Госномер — не поле vee-validate: форма отправляет его отдельным полем `plate`, а
// сервер склеивает с `car` (joinCar) для колонки таблицы и зеркала bookings.
const plate = defineModel<string>('plate', { required: true })
const emit = defineEmits<{ selectCar: [car: Car] }>()

// Объект из composable не меняется за время жизни формы, поэтому его можно разобрать один раз.
const { phoneRaw, onPhoneInput, onPhoneKeydown, onPhonePaste, onClickPastePhone } = props.phone

const auth = useAuthStore()
const shownError = useShownErrors()
const setName = useSetFieldValue<string>('name')
const carValue = useFieldValue<string | undefined>('car')
const setCar = useSetFieldValue<string>('car')

const {
  open: carPopoverOpen,
  activeIndex: carActiveIndex,
  listEl: carListEl,
  filtered: filteredCars,
  openSuggestions: openCarSuggestions,
  trackInput: trackCarInput,
  onItemPointerDown: onCarItemPointerDown,
  onItemPointerUp: onCarItemPointerUp,
  onKeydown: onCarKeydown,
} = useCarSuggestions(() => carValue.value ?? '', setCar)

function formatMissed(m: MissedBookings): string {
  const parts: string[] = []
  if (m.cancelled > 0) parts.push(`Отменял запись: ${m.cancelled}`)
  if (m.noShow > 0) parts.push(`Не приезжал: ${m.noShow}`)
  return `${parts.join(' · ')}. Последний раз — ${isoToDdmmyyyy(m.lastDate)}`
}

function onNameInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (isComposingInput(e)) {
    setName(target.value)
    return
  }
  const masked = maskName(target.value)
  writeMasked(target, masked)
  setName(masked)
}

function onCarInput(e: Event) {
  trackCarInput(e)
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (isComposingInput(e)) {
    setCar(target.value)
    return
  }
  const masked = maskCar(target.value)
  writeMasked(target, masked)
  setCar(masked)
}

function onLicensePlateInput(e: Event) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (isComposingInput(e)) {
    plate.value = target.value
    return
  }
  const masked = maskLicensePlate(target.value)
  if (writeMasked(target, masked)) plate.value = masked
}
</script>

<template>
  <Card class="gap-4 py-4 shadow-none">
    <CardHeader class="px-4">
      <CardTitle class="text-base">Информация о клиенте</CardTitle>
    </CardHeader>
    <CardContent class="px-4">
      <div class="space-y-4">
        <!-- Сначала телефон: найденный номер автоматически заполняет имя ниже (фича
           5.1), поэтому телефон открывает секцию клиента. -->
        <!-- Телефон (привязан к сырой строке с маской — намеренно вне FormField, см. F7) -->
        <div>
          <div class="mb-2 flex items-center gap-2">
            <Label>Номер телефона</Label>
            <!-- Спиннер, пока идет поиск по точному совпадению, чтобы пауза до
               появления чипа (или его отсутствия) читалась как «ищем», а не как тишина. -->
            <Spinner v-if="showLookupSpinner" class="size-4 text-muted-foreground" />
          </div>
          <div class="relative">
            <Input
              type="tel"
              inputmode="tel"
              class="h-11 pr-24"
              placeholder="+7 (___) ___-__-__"
              :model-value="phoneRaw"
              :aria-invalid="!!shownError('phone')"
              @input="onPhoneInput"
              @keydown="onPhoneKeydown"
              @paste="onPhonePaste"
            />
            <button
              type="button"
              aria-label="Вставить номер из буфера обмена"
              class="absolute right-1 top-1/2 -translate-y-1/2 h-9 px-3 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground text-xs font-medium"
              @click="onClickPastePhone"
            >
              Вставить
            </button>
          </div>
          <p v-if="shownError('phone')" class="text-sm font-medium text-destructive mt-1">
            {{ shownError('phone') }}
          </p>

          <!-- Подсказка распознанного клиента и его авто. Отдельная
             поверхность под телефоном (не в поповере «Марка и модель»):
             имя подставляется автоматически, авто — по тапу. -->
          <div v-if="matchedClient" class="mt-2">
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <User class="size-3.5 shrink-0" />
              <span>
                {{
                  matchedClient.name
                    ? `Найден клиент с именем: ${matchedClient.name}`
                    : 'Найден клиент без имени'
                }}
              </span>
            </div>
            <div
              v-if="matchedClientSummary"
              class="mt-1 space-y-0.5 pl-5.5 text-xs text-muted-foreground"
            >
              <p v-if="matchedClientSummary.visitCount > 0 && matchedClientSummary.lastVisit">
                Визитов: {{ matchedClientSummary.visitCount }} · последний
                {{ isoToDdmmyyyy(matchedClientSummary.lastVisit) }}
              </p>
              <p v-else>Завершенных визитов еще не было</p>
              <p v-if="matchedClientSummary.totalSpent" class="tabular-nums">
                Потрачено: {{ formatAmount(matchedClientSummary.totalSpent) }} ₽
              </p>
              <p v-if="matchedClientSummary.lastService" class="line-clamp-3 whitespace-pre-line">
                Последнее: {{ matchedClientSummary.lastService }}
              </p>
              <!-- Новая вкладка: уход с формы бросил бы ее на середине ввода, а
                 закрытие карточки ведет на /clients, а не обратно сюда. -->
              <RouterLink
                v-if="auth.isAdmin"
                :to="{ name: 'client-detail', params: { id: matchedClient.id } }"
                target="_blank"
                class="inline-block pt-0.5 font-medium text-foreground underline-offset-4 hover:underline"
              >
                Открыть карточку →
              </RouterLink>
            </div>
            <Alert v-if="matchedClientSummary?.missed" variant="destructive" class="mt-2">
              <TriangleAlert />
              <AlertTitle>Записывать только по предоплате</AlertTitle>
              <AlertDescription>
                {{ formatMissed(matchedClientSummary.missed) }}
              </AlertDescription>
            </Alert>
          </div>
        </div>

        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Имя</FormLabel>
            <FormControl>
              <Input
                type="text"
                class="h-11"
                placeholder="Иван"
                v-bind="componentField"
                @input="onNameInput"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="car">
          <FormItem>
            <FormLabel>Марка и модель</FormLabel>
            <div class="relative">
              <FormControl>
                <Input
                  type="text"
                  class="h-11"
                  placeholder="Toyota Camry"
                  autocomplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  :aria-expanded="carPopoverOpen && filteredCars.length > 0"
                  data-car-input
                  v-bind="componentField"
                  @focus="openCarSuggestions"
                  @click="openCarSuggestions"
                  @input="onCarInput"
                  @keydown="onCarKeydown"
                />
              </FormControl>
              <ul
                v-if="carPopoverOpen && filteredCars.length > 0"
                ref="carListEl"
                data-car-suggestions
                role="listbox"
                class="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
              >
                <li
                  v-for="(car, i) in filteredCars"
                  :key="car"
                  role="option"
                  :aria-selected="i === carActiveIndex"
                  :data-active="i === carActiveIndex"
                  class="cursor-pointer px-3 py-2 text-sm data-[active=true]:bg-accent"
                  @pointerdown.prevent="onCarItemPointerDown($event, i)"
                  @pointerup="onCarItemPointerUp($event, car)"
                  @mouseenter="carActiveIndex = i"
                >
                  {{ car }}
                </li>
              </ul>
            </div>
            <FormMessage />
          </FormItem>
        </FormField>

        <!-- Машины клиента чипами прямо под «Марка и модель» — первая подставляется
           автоматически; чипы появляются, только если машин несколько, чтобы переключиться. -->
        <div
          v-if="matchedClient && matchedClient.cars.length > 1"
          class="-mt-2 flex flex-wrap gap-1.5"
        >
          <button
            v-for="car in matchedClient.cars"
            :key="car.id"
            type="button"
            :aria-label="`Заполнить авто ${car.makeModel}${car.plate ? ' ' + car.plate : ''}`"
            class="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors"
            @click="emit('selectCar', car)"
          >
            {{ car.makeModel }}{{ car.plate ? ' · ' + car.plate : '' }}
          </button>
        </div>

        <div>
          <Label class="mb-2 block">
            Гос. номер
            <span class="text-muted-foreground font-normal">(необязательно)</span>
          </Label>
          <Input
            type="text"
            class="h-11"
            placeholder="А123АА777"
            maxlength="9"
            autocomplete="off"
            autocapitalize="characters"
            v-model="plate"
            @input="onLicensePlateInput"
          />
        </div>
      </div>
    </CardContent>
  </Card>
</template>
