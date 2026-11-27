import { inject, ref } from 'vue'
import { useFormErrors } from 'vee-validate'
import { FORM_SHOW_ERRORS_KEY } from '@/components/ui/form/injectionKeys'

// Ошибка поля из ближайшей формы vee-validate, но только после первой попытки
// отправки (см. FORM_SHOW_ERRORS_KEY): иначе пустая форма мелькает красным при монтировании.
export function useShownErrors() {
  const errors = useFormErrors()
  const show = inject(FORM_SHOW_ERRORS_KEY, ref(true))
  return (field: string): string | undefined => (show.value ? errors.value[field] : undefined)
}
