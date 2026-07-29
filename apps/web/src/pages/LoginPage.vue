<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useRoute, useRouter } from 'vue-router'
import { loginRequestSchema } from '@detailing-admin/shared'
import { homeRouteFor } from '@/router'
import { isSafeRedirect } from '@/lib/safe-redirect'
import { useAuthStore } from '@/stores/auth'
import AppLogo from '@/components/AppLogo.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const loginError = ref<string | null>(null)

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(loginRequestSchema),
  initialValues: { login: '', password: '' },
})

const onSubmit = handleSubmit(async (values) => {
  loginError.value = null
  const result = await auth.login(values)

  if (result.ok) {
    const redirect = route.query.redirect
    if (typeof redirect === 'string' && isSafeRedirect(redirect)) {
      await router.push(redirect)
    } else {
      await router.push(homeRouteFor(result.user.role))
    }
    return
  }

  if (result.error === 'unauthorized') {
    loginError.value = 'Неверный логин или пароль'
  } else if (result.error === 'unavailable') {
    loginError.value = result.message ?? 'База данных недоступна, попробуйте позже'
  } else {
    loginError.value = 'Не удалось войти. Попробуйте ещё раз'
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-muted/30 px-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center gap-2">
        <AppLogo :show-text="false" class="mb-2" />
        <CardTitle>Вход</CardTitle>
        <CardDescription>Введите логин и пароль</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit.prevent="onSubmit">
          <FormField v-slot="{ componentField }" name="login">
            <FormItem>
              <FormLabel>Логин</FormLabel>
              <FormControl>
                <Input type="text" autocomplete="username" v-bind="componentField" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="password">
            <FormItem>
              <FormLabel>Пароль</FormLabel>
              <FormControl>
                <Input type="password" autocomplete="current-password" v-bind="componentField" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <p v-if="loginError" class="text-sm font-medium text-destructive">{{ loginError }}</p>

          <Button type="submit" class="w-full" :disabled="isSubmitting">
            {{ isSubmitting ? 'Входим…' : 'Войти' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
