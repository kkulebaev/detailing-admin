<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { toast } from 'vue-sonner'
import { changePasswordRequestSchema } from '@detailing-admin/shared'
import { changePassword } from '@/lib/auth-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import PasswordInput from '@/components/PasswordInput.vue'

// Отдельный компонент, чтобы его контекст `useForm` не конфликтовал с контекстом
// формы имени в профиле (обоснование — в ProfileNameForm.vue).

// Wire-схема покрывает только currentPassword/newPassword — поле подтверждения
// проверяется только в UI, поэтому оно вынесено из типизированной схемы vee-validate
// и валидируется вручную при отправке (так же, как поле телефона в BookingForm).
type PasswordField = 'currentPassword' | 'newPassword'
function isPasswordField(v: unknown): v is PasswordField {
  return v === 'currentPassword' || v === 'newPassword'
}

const confirmPassword = ref('')
const confirmError = ref<string | null>(null)
// Перемонтирование полей после успешной смены снова скрывает их, чтобы следующий
// введенный здесь пароль не отображался открытым текстом.
const inputsGeneration = ref(0)

const { handleSubmit, resetForm, setFieldError, isSubmitting } = useForm({
  validationSchema: toTypedSchema(changePasswordRequestSchema),
  initialValues: { currentPassword: '', newPassword: '' },
})

const onSubmit = handleSubmit(async (values) => {
  confirmError.value = null
  if (values.newPassword !== confirmPassword.value) {
    confirmError.value = 'Пароли не совпадают'
    return
  }

  const result = await changePassword(values)
  if (result.ok) {
    toast.success('Пароль изменен')
    resetForm()
    confirmPassword.value = ''
    inputsGeneration.value++
    return
  }

  if (result.error === 'conflict' && result.reason === 'stale_password') {
    toast.error('Пароль уже был изменен в другой сессии — попробуйте еще раз')
  } else if (result.error === 'unauthorized') {
    toast.error('Сессия истекла — войдите снова')
  } else if (result.error === 'validation') {
    for (const issue of result.issues) {
      const field = issue.path[0]
      if (typeof field === 'string' && isPasswordField(field)) {
        setFieldError(field, issue.message)
      }
    }
  } else if (result.error === 'unavailable') {
    toast.error(result.message)
  } else {
    toast.error('Не удалось изменить пароль')
  }
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Смена пароля</CardTitle>
      <CardDescription>Введите текущий и новый пароль</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="grid gap-4" @submit.prevent="onSubmit">
        <FormField v-slot="{ componentField }" name="currentPassword">
          <FormItem>
            <FormLabel>Текущий пароль</FormLabel>
            <FormControl>
              <PasswordInput
                :key="inputsGeneration"
                autocomplete="current-password"
                v-bind="componentField"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="newPassword">
          <FormItem>
            <FormLabel>Новый пароль</FormLabel>
            <FormControl>
              <PasswordInput
                :key="inputsGeneration"
                autocomplete="new-password"
                v-bind="componentField"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <div class="grid gap-2">
          <Label for="confirm-password">Повторите новый пароль</Label>
          <PasswordInput
            id="confirm-password"
            :key="inputsGeneration"
            autocomplete="new-password"
            v-model="confirmPassword"
          />
          <p v-if="confirmError" class="text-sm font-medium text-destructive">{{ confirmError }}</p>
        </div>

        <Button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? 'Сохраняем…' : 'Сменить пароль' }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
