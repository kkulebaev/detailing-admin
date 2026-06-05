<script lang="ts" setup>
import type { LabelProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed, inject, ref } from "vue"
import { cn } from "@/lib/utils"
import { Label } from '@/components/ui/label'
import { useFormField } from "./useFormField"
import { FORM_SHOW_ERRORS_KEY } from "./injectionKeys"

const props = defineProps<LabelProps & { class?: HTMLAttributes["class"] }>()

const { error, formItemId } = useFormField()
const showErrors = inject(FORM_SHOW_ERRORS_KEY, ref(true))
const visibleError = computed(() => showErrors.value && !!error.value)
</script>

<template>
  <Label
    data-slot="form-label"
    :data-error="visibleError"
    :class="cn(
      'data-[error=true]:text-destructive',
      props.class,
    )"
    :for="formItemId"
  >
    <slot />
  </Label>
</template>
