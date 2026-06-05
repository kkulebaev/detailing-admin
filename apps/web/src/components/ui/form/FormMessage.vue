<script lang="ts" setup>
import type { HTMLAttributes } from "vue"
import { ErrorMessage } from "vee-validate"
import { inject, ref, toValue } from "vue"
import { cn } from "@/lib/utils"
import { useFormField } from "./useFormField"
import { FORM_SHOW_ERRORS_KEY } from "./injectionKeys"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { name, formMessageId } = useFormField()
const showErrors = inject(FORM_SHOW_ERRORS_KEY, ref(true))
</script>

<template>
  <ErrorMessage
    v-if="showErrors"
    :id="formMessageId"
    data-slot="form-message"
    as="p"
    :name="toValue(name)"
    :class="cn('text-destructive text-sm', props.class)"
  />
</template>
