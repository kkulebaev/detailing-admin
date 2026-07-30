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

// Own component (not inlined in ProfilePage) because vee-validate's `useForm`
// provides the form context to descendant FormFields — a second `useForm` in
// the same component would override that context and silently rewire these
// fields to the other form. One form per component keeps the contexts isolated.
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
    // Re-baseline so the form is no longer dirty against the saved values.
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
