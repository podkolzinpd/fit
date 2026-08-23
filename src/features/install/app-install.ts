export type InstallPlatform = 'ios' | 'android' | 'other'

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type InstallSnapshot = {
  installed: boolean
  promptAvailable: boolean
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

export function detectInstallPlatform(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): InstallPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios'
  if (/android/i.test(userAgent)) return 'android'
  return 'other'
}

export function isAppInstalled(
  targetWindow: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window,
  targetNavigator: NavigatorWithStandalone | undefined = typeof navigator === 'undefined' ? undefined : navigator as NavigatorWithStandalone,
): boolean {
  if (!targetWindow || !targetNavigator) return false
  return Boolean(targetWindow.matchMedia?.('(display-mode: standalone)').matches || targetNavigator.standalone)
}

export function getInstallSnapshot(): InstallSnapshot {
  return { installed: isAppInstalled(), promptAvailable: Boolean(deferredPrompt) }
}

export function subscribeInstallState(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export async function requestAppInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt
  if (!prompt) return 'unavailable'
  deferredPrompt = null
  notify()
  await prompt.prompt()
  return (await prompt.userChoice).outcome
}

export function installPromptStorageKey(userId: string) {
  return `fit.installPromptDismissed:v1:${userId}`
}

export function installPromptDismissed(userId: string): boolean {
  return localStorage.getItem(installPromptStorageKey(userId)) === 'true'
}

export function dismissInstallPrompt(userId: string) {
  localStorage.setItem(installPromptStorageKey(userId), 'true')
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', ((event: BeforeInstallPromptEvent) => {
    event.preventDefault()
    deferredPrompt = event
    notify()
  }) as EventListener)
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}
