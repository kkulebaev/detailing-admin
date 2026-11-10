<script setup lang="ts">
import { ref, type HTMLAttributes } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

// FormControl и vee-validate передают id, aria-* и обработчики как attrs: они
// должны попасть на <input>, а не на обертку InputGroup, иначе label и состояние
// ошибки указывали бы на div.
defineOptions({ inheritAttrs: false })

// Объявленный prop не пускает class в $attrs: размеры задаются группе, ведь
// пользователь видит полем именно ее рамку.
const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const model = defineModel<string>()
const visible = ref(false)
</script>

<template>
  <InputGroup :class="props.class">
    <!-- data-slot стоит после $attrs, потому что FormControl передает свой, а
         кольцо фокуса InputGroup завязано именно на это значение. -->
    <InputGroupInput
      v-bind="$attrs"
      v-model="model"
      data-slot="input-group-control"
      :type="visible ? 'text' : 'password'"
    />
    <InputGroupAddon align="inline-end">
      <InputGroupButton
        type="button"
        size="icon-sm"
        :aria-label="visible ? 'Скрыть пароль' : 'Показать пароль'"
        :aria-pressed="visible"
        @click="visible = !visible"
      >
        <EyeOff v-if="visible" class="size-4" />
        <Eye v-else class="size-4" />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
