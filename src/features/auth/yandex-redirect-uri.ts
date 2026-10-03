import { Capacitor } from '@capacitor/core'

export const ANDROID_YANDEX_CALLBACK = 'com.coachspace.fit://auth/yandex/callback'

export function yandexAuthorizationRedirectUri(): string {
  return Capacitor.getPlatform() === 'android'
    ? ANDROID_YANDEX_CALLBACK
    : `${window.location.origin}/auth/yandex/callback`
}
