<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import ProfileNameForm from '@/components/ProfileNameForm.vue'
import ChangePasswordForm from '@/components/ChangePasswordForm.vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'

const auth = useAuthStore()

// Two-letter monogram: first letters of the display name's words, else the
// first two of the login.
const initials = computed(() => {
  const parts = auth.displayName.split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [auth.displayName.slice(0, 2)]
  return letters.join('').toUpperCase()
})

// Only show the login as a subtitle once a real name is set — otherwise
// displayName already IS the login and repeating it reads as a duplicate.
const secondaryLogin = computed(() =>
  auth.user && auth.displayName !== auth.user.login ? auth.user.login : null,
)
</script>

<template>
  <div class="min-h-svh bg-background text-foreground p-4 sm:p-8">
    <div class="mx-auto grid max-w-md gap-6">
      <Card>
        <CardContent class="flex items-center gap-4">
          <Avatar class="size-14">
            <AvatarFallback class="text-lg font-semibold">{{ initials }}</AvatarFallback>
          </Avatar>
          <div class="grid gap-0.5">
            <span class="text-xl font-semibold leading-tight">{{ auth.displayName }}</span>
            <span v-if="secondaryLogin" class="text-sm text-muted-foreground">{{ secondaryLogin }}</span>
          </div>
        </CardContent>
      </Card>

      <ProfileNameForm />

      <ChangePasswordForm />
    </div>
  </div>
</template>
