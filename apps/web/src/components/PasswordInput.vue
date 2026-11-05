<script setup lang="ts">
import { ref, type HTMLAttributes } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

// FormControl and vee-validate hand id, aria-* and listeners down as attrs: they
// must reach the <input>, not the InputGroup wrapper, or the label and the error
// state would point at a div.
defineOptions({ inheritAttrs: false })

// A declared prop keeps class out of $attrs: sizing belongs on the group, whose
// border is what the user sees as the field.
const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const model = defineModel<string>()
const visible = ref(false)
</script>

<template>
  <InputGroup :class="props.class">
    <!-- data-slot comes after $attrs because FormControl passes its own, and
         InputGroup's focus ring is keyed on this exact value. -->
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
