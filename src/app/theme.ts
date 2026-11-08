import { useSyncExternalStore } from 'react'
import { readPreferenceStorage, writePreferenceStorage } from './preference-storage'

export type AppTheme = 'light' | 'dark'

export type ThemeVariant = AppTheme

export const THEME_STORAGE_KEY = 'fit.appTheme'
const THEME_CHANGE_EVENT = 'fit-theme-change'

// Цвет системной панели браузера/WKWebView совпадает с фоном варианта, иначе
// над экраном остаётся полоса чужой палитры.
const MONOCHROME_THEME_COLOR: Record<AppTheme, string> = {
  light: '#FBFAF7',
  dark: '#111214',
}

const THEME_VARIANT_CLASS: Record<ThemeVariant, string> = {
  light: 'theme-light',
  dark: '',
}

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

export function resolveThemeVariant(theme: AppTheme): ThemeVariant {
  return theme
}

export function themeVariantClass(variant: ThemeVariant): string {
  return THEME_VARIANT_CLASS[variant]
}

export function getAppTheme(): AppTheme {
  if (typeof window === 'undefined') return APP_THEME
  return resolveThemePreference(readPreferenceStorage(THEME_STORAGE_KEY))
}

export function applyThemeVariant(variant: ThemeVariant) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('theme-light', variant === 'light')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', MONOCHROME_THEME_COLOR[variant])
}

// Вызывается до первого render, когда аккаунт ещё неизвестен, поэтому пилотный
// вариант здесь недоступен: его подключает AppLayout, как только auth вернул
// actor и allowlist можно проверить.
export function applyAppTheme(theme: AppTheme) {
  applyThemeVariant(resolveThemeVariant(theme))
  if (typeof document === 'undefined') return
  document.documentElement.classList.add('ui-identity')
  applyMonochromeThemeColor(theme)
}

export function applyMonochromeThemeColor(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', MONOCHROME_THEME_COLOR[theme])
}

export function setAppTheme(theme: AppTheme) {
  writePreferenceStorage(THEME_STORAGE_KEY, theme)
  applyThemeVariant(resolveThemeVariant(theme))
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
