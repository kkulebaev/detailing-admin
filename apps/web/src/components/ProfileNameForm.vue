<script setup lang="ts">
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { toast } from 'vue-sonner'
import { updateProfileRequestSchema } from '@detailing-admin/shared'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

// Отдельный компонент (а не часть ProfilePage), потому что `useForm` из vee-validate
// передаёт контекст формы вложенным FormField — второй `useForm` в том же
// компоненте перекрыл бы этот контекст и незаметно привязал бы эти поля
// к другой форме. Одна форма на компонент держит контексты раздельно.
const auth = useAuthStore()

type NameField = 'firstName' | 'lastName'
function isNameField(v: unknown): v is NameField {
  return v === 'firstName' || v === 'lastName'
}

const { handleSubmit, isSubmitting, resetForm, setFieldError } = useForm({
  validationSchema: toTypedSchema(updateProfileRequestSchema),
  initialValues: {
    firstName: auth.user?.firstName ?? '',
    lastName: auth.user?.lastName ?? '',
  },
})

const onSubmit = handleSubmit(async (values) => {
  const result = await auth.updateProfile(values)
  if (result.ok) {
    toast.success('Данные сохранены')
    // Обновляем исходные значения, чтобы форма не считалась изменённой относительно сохранённых.
    resetForm({ values: { firstName: result.user.firstName, lastName: result.user.lastName } })
    return
  }

  if (result.error === 'validation') {
    for (const issue of result.issues) {
      const field = issue.path[0]
      if (typeof field === 'string' && isNameField(field)) {
        setFieldError(field, issue.message)
      }
    }
  } else if (result.error === 'unauthorized') {
    toast.error('Сессия истекла — войдите снова')
  } else if (result.error === 'unavailable') {
    toast.error(result.message)
  } else {
    toast.error('Не удалось сохранить данные')
  }
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Личные данные</CardTitle>
      <CardDescription>Имя и фамилия, которые видите вы и коллеги</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="grid gap-4" @submit.prevent="onSubmit">
        <FormField v-slot="{ componentField }" name="firstName">
          <FormItem>
            <FormLabel>Имя</FormLabel>
            <FormControl>
              <Input type="text" autocomplete="given-name" v-bind="componentField" />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="lastName">
          <FormItem>
            <FormLabel>Фамилия</FormLabel>
            <FormControl>
              <Input type="text" autocomplete="family-name" v-bind="componentField" />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <Button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? 'Сохраняем…' : 'Сохранить' }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
