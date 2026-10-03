import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { isPendingYandexAuthorizationState } from './yandex-pilot-oauth'
import { ANDROID_YANDEX_CALLBACK } from './yandex-redirect-uri'

export function androidYandexCallbackPath(
  incomingUrl: string,
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): string | null {
  let url: URL
  try {
    url = new URL(incomingUrl)
  } catch {
    return null
  }
  const callback = new URL(ANDROID_YANDEX_CALLBACK)
  if (url.protocol !== callback.protocol || url.host !== callback.host || url.pathname !== callback.pathname) return null
  if (!isPendingYandexAuthorizationState(url.searchParams.get('state'), storage)) return null
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null
  return `/auth/yandex/callback${url.search}`
}

export async function initializeAndroidYandexDeepLink(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return

  const openCallback = (url: string): void => {
    const path = androidYandexCallbackPath(url)
    if (path !== null && `${window.location.pathname}${window.location.search}` !== path) {
      window.location.assign(path)
    }
  }

  await App.addListener('appUrlOpen', ({ url }) => openCallback(url))
  const launch = await App.getLaunchUrl()
  if (launch?.url) openCallback(launch.url)
}
