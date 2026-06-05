import type { InjectionKey, Ref } from "vue"

export const FORM_ITEM_INJECTION_KEY
  = Symbol() as InjectionKey<string>

export const FORM_SHOW_ERRORS_KEY
  = Symbol() as InjectionKey<Ref<boolean>>
