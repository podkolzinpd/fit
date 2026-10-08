import { useSyncExternalStore } from 'react'
import type { AppTheme } from './theme'

export type ClientLimeThemePreference = AppTheme | 'system'
const eventName = 'fit-client-lime-theme-change'
const mediaQuery = '(prefers-color-scheme: dark)'
// Only used if browser storage is unavailable; each actor keeps its own choice.
const sessionPreferences = new Map<string, ClientLimeThemePreference>()
export const clientLimeThemeKey = (userId: string) => `fit.clientLime.theme.${userId}`

export function getClientLimeThemePreference(userId: string): ClientLimeThemePreference {
  try {
    const stored = window.localStorage.getItem(clientLimeThemeKey(userId))
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark'
  } catch { /* Storage may be unavailable in private webviews. */ }
  return sessionPreferences.get(userId) ?? 'dark'
}
export function setClientLimeThemePreference(userId: string, value: ClientLimeThemePreference) {
  sessionPreferences.set(userId, value)
  try { window.localStorage.setItem(clientLimeThemeKey(userId), value) } catch { /* Session choice remains usable. */ }
  window.dispatchEvent(new Event(eventName))
}
function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(mediaQuery)
  window.addEventListener(eventName, onChange)
  window.addEventListener('storage', onChange)
  media?.addEventListener('change', onChange)
  return () => {
    window.removeEventListener(eventName, onChange)
    window.removeEventListener('storage', onChange)
    media?.removeEventListener('change', onChange)
  }
}
export function useClientLimeTheme(userId: string) {
  const preference = useSyncExternalStore(subscribe, () => getClientLimeThemePreference(userId), () => 'dark' as const)
  const systemDark = useSyncExternalStore(subscribe, () => (window.matchMedia?.(mediaQuery).matches ?? false), () => false)
  const theme: AppTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  return { preference, theme }
}
