import { useSyncExternalStore } from 'react'

export type AppTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'fit.appTheme'
const THEME_CHANGE_EVENT = 'fit-theme-change'

// Светлая тема прошла маршрутный пилот и теперь является основной. Значение
// сборки остаётся безопасным fallback, а явный выбор пользователя хранится
// локально на устройстве и имеет приоритет.
export function resolveAppTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export const APP_THEME = resolveAppTheme(import.meta.env.VITE_APP_THEME)

export function resolveThemePreference(value: unknown, fallback: AppTheme = APP_THEME): AppTheme {
  return value === 'light' || value === 'dark' ? value : fallback
}

export function getAppTheme(): AppTheme {
  if (typeof window === 'undefined') return APP_THEME
  try {
    return resolveThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return APP_THEME
  }
}

export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  const lightTheme = theme === 'light'
  document.documentElement.classList.toggle('theme-light', lightTheme)
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', lightTheme ? '#f7f4ef' : '#15131a')
}

export function setAppTheme(theme: AppTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Тема всё равно применяется на текущую сессию, даже если хранилище
    // браузера недоступно (например, в приватном WKWebView-контексте).
  }
  applyAppTheme(theme)
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

function subscribeToTheme(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onStoreChange()
  }
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAppTheme() {
  return useSyncExternalStore(subscribeToTheme, getAppTheme, () => APP_THEME)
}
