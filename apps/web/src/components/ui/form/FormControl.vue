<script lang="ts" setup>
import { Slot } from "reka-ui"
import { computed, inject, ref } from "vue"
import { useFormField } from "./useFormField"
import { FORM_SHOW_ERRORS_KEY } from "./injectionKeys"

const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
const showErrors = inject(FORM_SHOW_ERRORS_KEY, ref(true))
const visibleError = computed(() => (showErrors.value ? error.value : undefined))
</script>

<template>
  <Slot
    :id="formItemId"
    data-slot="form-control"
    :aria-describedby="!visibleError ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`"
    :aria-invalid="!!visibleError"
  >
    <slot />
  </Slot>
</template>
