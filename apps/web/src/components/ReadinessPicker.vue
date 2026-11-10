<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import { READINESS, type BookingRow, type Readiness } from '@detailing-admin/shared'
import { readinessBadgeClass } from '@/lib/readiness'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Чип статуса, который заодно выбирает статус в одно касание — смена готовности
// самое частое действие в списке записей, и в компактной строке чип должен
// уместиться в одну линию с услугой, не добавляя высоты. Dropdown (а не Select),
// чтобы триггером был сам чип, а не элемент управления во всю ширину.
//
// `readonly` рисует тот же чип без меню: сотрудники не могут делать PATCH
// записей, но статус в строке им всё равно нужно видеть.
// `plain` рисует один текст со стрелкой — он живёт на строке, уже залитой цветом
// статуса, и рамка с точкой поверх заливки только шумели бы. `badge` тонирует
// себя сам: в диалоге фон нейтральный, и цвет нужно нести самому чипу.
const props = withDefaults(
  defineProps<{
    readiness: BookingRow['readiness']
    variant?: 'plain' | 'badge'
    readonly?: boolean
    disabled?: boolean
  }>(),
  { variant: 'badge' },
)

const emit = defineEmits<{
  (e: 'update', value: Readiness | ''): void
}>()

// Radio group из reka-ui не принимает пустое значение, поэтому «нет статуса»
// передаётся значением-заглушкой — тот же приём, что в Select на странице.
const NONE = '__none__'

// reka-ui возвращает свой размытый `AcceptableValue`, отсюда сужение типа.
function onSelect(value: unknown) {
  const picked = String(value)
  const next = picked === NONE ? '' : (READINESS.find((r) => r === picked) ?? '')
  if (next === props.readiness) return
  emit('update', next)
}
</script>

<template>
  <span
    v-if="props.readonly && props.variant === 'plain'"
    class="font-medium"
    :class="{ 'text-muted-foreground': !props.readiness }"
  >
    {{ props.readiness || 'нет статуса' }}
  </span>

  <span
    v-else-if="props.readonly"
    class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
    :class="readinessBadgeClass(props.readiness)"
  >
    {{ props.readiness || 'нет статуса' }}
  </span>

  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child>
      <!-- `click.stop`: компактная строка сама открывает диалог с подробностями. -->
      <!-- В `plain` отрицательные поля растягивают зону тапа до ~32px, не сдвигая
           текст; `badge` набирает ту же высоту паддингами. -->
      <button
        type="button"
        :disabled="props.disabled"
        class="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap disabled:opacity-50"
        :class="
          props.variant === 'plain'
            ? '-mx-1 -my-1.5 px-1 py-1.5 font-medium underline-offset-2 hover:underline'
            : [readinessBadgeClass(props.readiness), 'rounded-full px-2 py-1 text-xs font-medium']
        "
        :aria-label="`Готовность: ${props.readiness || 'нет статуса'}`"
        @click.stop
      >
        <span :class="{ 'text-muted-foreground': props.variant === 'plain' && !props.readiness }">
          {{ props.readiness || 'нет статуса' }}
        </span>
        <ChevronDown class="size-3 shrink-0 opacity-50" />
      </button>
    </DropdownMenuTrigger>
    <!-- Без собственного max-height: reka сама меряет свободное место, и меню
         из одиннадцати пунктов открывается целиком, а не со скроллом. -->
    <DropdownMenuContent align="end" class="min-w-48" @click.stop>
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
        Готовность
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="props.readiness || NONE" @update:model-value="onSelect">
        <!-- Индикатор выбора — галочка, а не штатный залитый кружок: тот читался
             как ещё одна цветовая метка статуса. -->
        <DropdownMenuRadioItem
          v-for="r in READINESS"
          :key="r"
          :value="r"
          class="data-[state=checked]:font-medium"
        >
          <template #indicator-icon>
            <Check class="size-4" />
          </template>
          {{ r }}
        </DropdownMenuRadioItem>

        <DropdownMenuSeparator />

        <!-- Сброс статуса — отдельно внизу, а не первым в ряду рабочих статусов. -->
        <DropdownMenuRadioItem
          :value="NONE"
          class="text-muted-foreground data-[state=checked]:font-medium"
        >
          <template #indicator-icon>
            <Check class="size-4" />
          </template>
          нет статуса
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
