<script setup lang="ts">
import { provide, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useRoute, useRouter } from 'vue-router'
import { loginRequestSchema } from '@detailing-admin/shared'
import { Eye, EyeOff, LoaderCircle, MousePointerClick, TriangleAlert } from '@lucide/vue'
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { FORM_SHOW_ERRORS_KEY } from '@/components/ui/form/injectionKeys'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const loginError = ref<string | null>(null)
const showPassword = ref(false)

// Field errors stay hidden until the first submit attempt, then update live as
// the user corrects them — avoids "Укажите логин/пароль" flashing on blur or
// mid-typing before the user has tried to submit. FormControl/Label/Message
// read this key to gate their error UI.
const showErrors = ref(false)
provide(FORM_SHOW_ERRORS_KEY, showErrors)

const { handleSubmit, isSubmitting, values, setValues, setFieldValue } = useForm({
  validationSchema: toTypedSchema(loginRequestSchema),
  initialValues: { login: '', password: '', remember: false },
})

// TEMP: matches the shared demo credentials shown below — remove alongside them.
const DEMO_LOGIN = 'dglotov'
const DEMO_PASSWORD = 'adminadmin'

function fillDemoCredentials() {
  setValues({ login: DEMO_LOGIN, password: DEMO_PASSWORD })
}

// Drop the server-side "wrong credentials" alert as soon as the user edits a
// field, so a stale error doesn't linger while they retype.
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

// Reveal validation errors only once the user actually tries to submit; from
// then on they update live via vee-validate.
function onSubmit() {
  showErrors.value = true
  void submit()
}
</script>

<template>
  <div class="login-page flex min-h-screen items-center justify-center px-4 py-12">
    <Card class="w-full max-w-sm shadow-lg">
      <CardHeader class="items-center justify-items-center gap-3 text-center">
        <img
          src="/apple-touch-icon.png"
          alt="Dazzle Detailing"
          class="size-16 rounded-full"
        >
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
              <InputGroup class="h-11">
                <FormControl>
                  <InputGroupInput
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="current-password"
                    v-bind="componentField"
                  />
                </FormControl>
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
                    :aria-pressed="showPassword"
                    @click="showPassword = !showPassword"
                  >
                    <EyeOff v-if="showPassword" class="size-4" />
                    <Eye v-else class="size-4" />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
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

        <!-- TEMP: shared demo credentials until each user gets their own account
             and changes the password. Remove this whole block afterwards. -->
        <button
          type="button"
          class="mt-5 flex w-full flex-col items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-center text-sm text-muted-foreground transition-colors hover:border-ring/60 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          @click="fillDemoCredentials"
        >
          <span class="flex items-center gap-1.5 font-medium">
            <MousePointerClick class="size-4" />
            Временный доступ
          </span>
          <span>Логин: <span class="font-mono text-foreground">dglotov</span></span>
          <span>Пароль: <span class="font-mono text-foreground">adminadmin</span></span>
          <span class="mt-1 text-xs">Нажмите, чтобы подставить логин и пароль</span>
        </button>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.login-page {
  /*
   * Brand orange (#f05000), scoped to this page only — the app-wide
   * --primary/--ring stay neutral (see globals.css). --primary here is
   * darkened from the raw brand hue: #f05000 on white text is only ~3.2:1,
   * below WCAG AA (4.5:1), so the button surface uses a deeper shade of the
   * same hue/chroma (~5.3:1) while --ring keeps the true brand color for
   * focus outlines, where only 3:1 non-text contrast is required.
   */
  --brand: oklch(0.646 0.207 39);
  --primary: oklch(0.55 0.19 39);
  --primary-foreground: oklch(0.985 0 0);
  --ring: var(--brand);

  background:
    radial-gradient(60% 45% at 50% 0%, color-mix(in oklch, var(--brand) 10%, transparent), transparent 70%),
    var(--background);
}
</style>
