<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { toast } from 'vue-sonner'
import { changePasswordRequestSchema } from '@detailing-admin/shared'
import { changePassword } from '@/lib/auth-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

// The wire schema only covers currentPassword/newPassword — the confirmation
// field is a UI-only check, so it's kept out of the typed vee-validate schema
// and validated by hand at submit time (mirrors BookingForm's phone field).
type ProfileField = 'currentPassword' | 'newPassword'
function isProfileField(v: unknown): v is ProfileField {
  return v === 'currentPassword' || v === 'newPassword'
}

const confirmPassword = ref('')
const confirmError = ref<string | null>(null)

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
    toast.success('Пароль изменён')
    resetForm()
    confirmPassword.value = ''
    return
  }

  if (result.error === 'conflict' && result.reason === 'stale_password') {
    toast.error('Пароль уже был изменён в другой сессии — попробуйте ещё раз')
  } else if (result.error === 'unauthorized') {
    toast.error('Сессия истекла — войдите снова')
  } else if (result.error === 'validation') {
    for (const issue of result.issues) {
      const field = issue.path[0]
      if (typeof field === 'string' && isProfileField(field)) {
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
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <Card class="max-w-md mx-auto">
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
                <Input type="password" autocomplete="current-password" v-bind="componentField" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="newPassword">
            <FormItem>
              <FormLabel>Новый пароль</FormLabel>
              <FormControl>
                <Input type="password" autocomplete="new-password" v-bind="componentField" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <div class="grid gap-2">
            <Label for="confirm-password">Повторите новый пароль</Label>
            <Input
              id="confirm-password"
              type="password"
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
  </div>
</template>
