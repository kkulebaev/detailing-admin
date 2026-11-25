<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  fetchPushPublicKey,
  isPushSubscribed,
  notificationPermission,
  pushSupport,
  subscribePush,
  unsubscribePush,
} from '@/lib/push'

type State =
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'unsupported' }
  | { kind: 'ios-needs-install' }
  | { kind: 'denied' }
  | { kind: 'ready'; publicKey: string; enabled: boolean }

const state = ref<State>({ kind: 'loading' })
const busy = ref(false)

onMounted(async () => {
  try {
    // Сначала сервер: без ключей подсказка про экран «Домой» только зря гоняла бы на iPhone.
    const publicKey = await fetchPushPublicKey()
    if (!publicKey) {
      state.value = { kind: 'not-configured' }
      return
    }
    const support = pushSupport()
    if (support !== 'supported') {
      state.value = { kind: support }
      return
    }
    if (notificationPermission() === 'denied') {
      state.value = { kind: 'denied' }
      return
    }
    state.value = { kind: 'ready', publicKey, enabled: await isPushSubscribed() }
  } catch {
    state.value = { kind: 'not-configured' }
  }
})

// Переключатель двигается только после ответа: показать «включено» до подписки значило
// бы соврать, если пользователь откажет в разрешении.
async function onToggle(next: boolean) {
  const current = state.value
  if (current.kind !== 'ready' || busy.value) return
  busy.value = true
  try {
    if (!next) {
      await unsubscribePush()
      state.value = { ...current, enabled: false }
      return
    }
    const result = await subscribePush(current.publicKey)
    if (result === 'subscribed') {
      state.value = { ...current, enabled: true }
      toast.success('Пуши включены на этом устройстве')
    } else if (result === 'denied' && notificationPermission() === 'denied') {
      state.value = { kind: 'denied' }
    } else if (result === 'error') {
      toast.error('Не удалось включить пуши')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Уведомления</CardTitle>
      <CardDescription
        >Лента в приложении работает всегда; пуши приходят на телефон</CardDescription
      >
    </CardHeader>
    <CardContent>
      <p v-if="state.kind === 'loading'" class="text-sm text-muted-foreground">Загружаем…</p>
      <p v-else-if="state.kind === 'not-configured'" class="text-sm text-muted-foreground">
        Пуши пока не настроены на сервере.
      </p>
      <p v-else-if="state.kind === 'unsupported'" class="text-sm text-muted-foreground">
        Этот браузер не поддерживает пуши.
      </p>
      <p v-else-if="state.kind === 'ios-needs-install'" class="text-sm text-muted-foreground">
        Добавьте приложение на экран „Домой“: в Safari нажмите «Поделиться», затем «На экран
        „Домой“», и откройте приложение с иконки. На iPhone пуши работают только так.
      </p>
      <p v-else-if="state.kind === 'denied'" class="text-sm text-muted-foreground">
        Уведомления для этого сайта запрещены. Разрешите их в настройках браузера (значок слева от
        адреса → «Уведомления») или телефона и обновите страницу.
      </p>
      <div v-else class="flex items-center justify-between gap-4">
        <Label for="push-toggle" class="cursor-pointer">Пуши на этом устройстве</Label>
        <Switch
          id="push-toggle"
          :model-value="state.enabled"
          :disabled="busy"
          @update:model-value="onToggle"
        />
      </div>
    </CardContent>
  </Card>
</template>
