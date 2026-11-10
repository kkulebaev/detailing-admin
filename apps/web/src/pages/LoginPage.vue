<script setup lang="ts">
import { provide, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useRoute, useRouter } from 'vue-router'
import { loginRequestSchema } from '@detailing-admin/shared'
import { LoaderCircle, TriangleAlert } from '@lucide/vue'
import { homeRouteFor } from '@/router'
import { isSafeRedirect } from '@/lib/safe-redirect'
import { useAuthStore } from '@/stores/auth'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FORM_SHOW_ERRORS_KEY } from '@/components/ui/form/injectionKeys'
import PasswordInput from '@/components/PasswordInput.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const loginError = ref<string | null>(null)

// Ошибки полей скрыты до первой попытки отправки, а затем обновляются на лету,
// пока пользователь их исправляет, — чтобы «Укажите логин/пароль» не мелькало
// на blur или посреди ввода до попытки отправить. FormControl/Label/Message
// читают этот ключ, чтобы решить, показывать ли ошибку.
const showErrors = ref(false)
provide(FORM_SHOW_ERRORS_KEY, showErrors)

const { handleSubmit, isSubmitting, values, setFieldValue } = useForm({
  validationSchema: toTypedSchema(loginRequestSchema),
  initialValues: { login: '', password: '', remember: false },
})

// Убираем серверное предупреждение «неверные учётные данные», как только
// пользователь правит поле, чтобы устаревшая ошибка не висела, пока он вводит заново.
watch(
  () => [values.login, values.password],
  () => {
    if (loginError.value) loginError.value = null
  },
)

const submit = handleSubmit(async (formValues) => {
  loginError.value = null
  const result = await auth.login(formValues)

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

// Ошибки валидации показываем, только когда пользователь действительно пытается
// отправить форму; дальше они обновляются на лету через vee-validate.
function onSubmit() {
  showErrors.value = true
  void submit()
}
</script>

<template>
  <div class="login-page flex min-h-screen items-center justify-center px-4 py-12">
    <Card class="w-full max-w-sm shadow-lg">
      <CardHeader class="items-center justify-items-center gap-3 text-center">
        <img src="/apple-touch-icon.png" alt="Dazzle Detailing" class="size-16 rounded-full" />
        <div class="grid gap-1">
          <CardTitle class="text-xl">Вход в систему</CardTitle>
          <CardDescription>Введите логин и пароль, чтобы продолжить</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form class="grid gap-5" @submit.prevent="onSubmit">
          <FormField v-slot="{ componentField }" name="login">
            <FormItem>
              <FormLabel>Логин</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autocomplete="username"
                  autofocus
                  class="h-11"
                  v-bind="componentField"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="password">
            <FormItem>
              <FormLabel>Пароль</FormLabel>
              <FormControl>
                <PasswordInput
                  class="h-11"
                  autocomplete="current-password"
                  v-bind="componentField"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <div class="flex items-center gap-2">
            <Checkbox
              id="remember"
              :model-value="values.remember"
              :disabled="isSubmitting"
              @update:model-value="(v) => setFieldValue('remember', v === true)"
            />
            <Label for="remember" class="cursor-pointer font-normal text-muted-foreground">
              Запомнить меня
            </Label>
          </div>

          <Alert v-if="loginError" variant="destructive">
            <TriangleAlert />
            <AlertDescription>{{ loginError }}</AlertDescription>
          </Alert>

          <Button type="submit" class="h-11 w-full active:bg-primary/80" :disabled="isSubmitting">
            <LoaderCircle v-if="isSubmitting" class="size-4 animate-spin" />
            {{ isSubmitting ? 'Входим…' : 'Войти' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.login-page {
  /*
   * Фирменный оранжевый (#f05000) только на этой странице — общие для
   * приложения --primary/--ring остаются нейтральными (см. globals.css).
   * --primary здесь темнее исходного фирменного тона: #f05000 под белым текстом
   * даёт лишь ~3.2:1, ниже WCAG AA (4.5:1), поэтому фон кнопки — более глубокий
   * оттенок того же тона/насыщенности (~5.3:1), а --ring сохраняет настоящий
   * фирменный цвет для обводки фокуса, где нужен лишь контраст 3:1 для не-текста.
   */
  --brand: oklch(0.646 0.207 39);
  --primary: oklch(0.55 0.19 39);
  --primary-foreground: oklch(0.985 0 0);
  --ring: var(--brand);

  background:
    radial-gradient(
      60% 45% at 50% 0%,
      color-mix(in oklch, var(--brand) 10%, transparent),
      transparent 70%
    ),
    var(--background);
}
</style>
