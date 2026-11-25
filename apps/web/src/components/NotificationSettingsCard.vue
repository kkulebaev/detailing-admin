<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
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
import { createTelegramLink, fetchTelegramStatus, unlinkTelegram } from '@/lib/notifications-api'

type State =
  | { kind: 'loading' }
  | { kind: 'not-configured' }
  | { kind: 'unsupported' }
  | { kind: 'ios-needs-install' }
  | { kind: 'denied' }
  | { kind: 'ready'; publicKey: string; enabled: boolean }

const state = ref<State>({ kind: 'loading' })
const busy = ref(false)

type TelegramState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; connected: boolean }

const telegram = ref<TelegramState>({ kind: 'loading' })
const telegramBusy = ref(false)

async function loadTelegram() {
  try {
    const res = await fetchTelegramStatus()
    // Подключенный чат работает и без приема апдейтов (сообщения шлет sendMessage), поэтому
    // «недоступен» показываем, только когда подключить нельзя.
    if (!res.ok || (!res.connected && !res.botAvailable)) telegram.value = { kind: 'unavailable' }
    else telegram.value = { kind: 'ready', connected: res.connected }
  } catch {
    telegram.value = { kind: 'unavailable' }
  }
}

// Привязка завершается в Telegram, а не здесь: вернувшись на вкладку, перечитываем статус.
function onReturn() {
  if (document.visibilityState === 'visible' && !telegramBusy.value) void loadTelegram()
}

onMounted(() => {
  void loadTelegram()
  document.addEventListener('visibilitychange', onReturn)
  window.addEventListener('focus', onReturn)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onReturn)
  window.removeEventListener('focus', onReturn)
})

async function connectTelegram() {
  if (telegramBusy.value) return
  telegramBusy.value = true
  // Окно открывается синхронно, прямо в обработчике тапа: после await Safari на iPhone
  // считает window.open всплывающим окном и блокирует его.
  const win = window.open('', '_blank')
  try {
    const res = await createTelegramLink()
    if (!res.ok) {
      win?.close()
      if (res.error === 'bot_unavailable') telegram.value = { kind: 'unavailable' }
      else toast.error('Не удалось получить ссылку на Telegram')
      return
    }
    if (win) {
      win.opener = null
      win.location.href = res.url
    } else {
      // Окно все-таки заблокировали: t.me в этой вкладке откроет приложение Telegram.
      window.location.href = res.url
    }
  } catch {
    win?.close()
    toast.error('Не удалось получить ссылку на Telegram')
  } finally {
    telegramBusy.value = false
  }
}

async function disconnectTelegram() {
  if (telegramBusy.value) return
  telegramBusy.value = true
  try {
    const res = await unlinkTelegram()
    if (res.ok) {
      telegram.value = { kind: 'ready', connected: false }
      void loadTelegram()
    } else {
      toast.error('Не удалось отключить Telegram')
    }
  } catch {
    toast.error('Не удалось отключить Telegram')
  } finally {
    telegramBusy.value = false
  }
}

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
    <CardContent class="grid gap-4">
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

      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-4">
        <div class="grid gap-0.5">
          <span class="text-sm font-medium">Telegram</span>
          <span v-if="telegram.kind === 'loading'" class="text-sm text-muted-foreground"
            >Загружаем…</span
          >
          <span v-else-if="telegram.kind === 'unavailable'" class="text-sm text-muted-foreground"
            >Telegram недоступен</span
          >
          <span v-else-if="telegram.connected" class="text-sm text-muted-foreground"
            >Подключено</span
          >
          <span v-else class="text-sm text-muted-foreground"
            >Деньги и заявки на график придут в чат с ботом</span
          >
        </div>
        <template v-if="telegram.kind === 'ready'">
          <Button
            v-if="telegram.connected"
            variant="outline"
            :disabled="telegramBusy"
            @click="disconnectTelegram"
            >Отключить</Button
          >
          <Button v-else :disabled="telegramBusy" @click="connectTelegram">Подключить</Button>
        </template>
      </div>
    </CardContent>
  </Card>
</template>
