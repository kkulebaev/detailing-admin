<script setup lang="ts">
import type { ListboxFilterProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Search } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { ListboxFilter, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"
import { useCommand } from "."

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ListboxFilterProps & {
  class?: HTMLAttributes["class"]
}>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)

const { filterState } = useCommand()

// reka-ui's ListboxFilter suppresses model updates while an IME composition is
// active (`handleInput` early-returns on `isComposing`), syncing only on
// `compositionend`. Android's Gboard keeps a word in composition until a
// space/punctuation/suggestion commit, so typing a single word (e.g. «Демонтаж»)
// never fired `compositionend` and the list stayed unfiltered. Mirror each
// composition step straight into the filter so search is live mid-word; the
// component's own compositionend handler then re-applies the same value.
function onCompositionUpdate(event: Event) {
  const target = event.target
  if (target instanceof HTMLInputElement) filterState.search = target.value
}
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    class="flex h-9 items-center gap-2 border-b px-3"
  >
    <Search class="size-4 shrink-0 opacity-50" />
    <!-- No auto-focus: on mobile it pops the keyboard the instant the popover
         opens. The list is scroll/tap-first; focusing the field (and raising the
         keyboard) is left to an explicit tap. Pass :auto-focus to opt back in. -->
    <ListboxFilter
      v-bind="{ ...forwardedProps, ...$attrs }"
      v-model="filterState.search"
      data-slot="command-input"
      @compositionupdate="onCompositionUpdate"
      :class="cn('placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    />
  </div>
</template>
