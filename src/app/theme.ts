import { useSyncExternalStore } from 'react'

export type AppTheme = 'light' | 'dark'

// Пилотная тёмная палитра — не третья тема, а вариант тёмной. Пользователь
// по-прежнему выбирает «светлая/тёмная»; какой из двух тёмных наборов токенов
// применить, решает allowlist, а не переключатель в профиле.
export type ThemeVariant = 'light' | 'dark' | 'dark-pilot'

export const THEME_STORAGE_KEY = 'fit.appTheme'
const THEME_CHANGE_EVENT = 'fit-theme-change'

// Цвет системной панели браузера/WKWebView совпадает с фоном варианта, иначе
// над экраном остаётся полоса чужой палитры.
const THEME_COLOR: Record<ThemeVariant, string> = {
  light: '#f7f4ef',
  dark: '#15131a',
  'dark-pilot': '#000000',
}

const MONOCHROME_THEME_COLOR: Record<AppTheme, string> = {
  light: '#FBFAF7',
  dark: '#111214',
}

const THEME_VARIANT_CLASS: Record<ThemeVariant, string> = {
  light: 'theme-light',
  dark: '',
  'dark-pilot': 'theme-dark-pilot',
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

export function resolveThemeVariant(theme: AppTheme, darkPilot: boolean): ThemeVariant {
  if (theme === 'light') return 'light'
  return darkPilot ? 'dark-pilot' : 'dark'
}

export function themeVariantClass(variant: ThemeVariant): string {
  return THEME_VARIANT_CLASS[variant]
}

export function getAppTheme(): AppTheme {
  if (typeof window === 'undefined') return APP_THEME
  try {
    return resolveThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return APP_THEME
  }
}

export function applyThemeVariant(variant: ThemeVariant) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('theme-light', variant === 'light')
  root.classList.toggle('theme-dark-pilot', variant === 'dark-pilot')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[variant])
}

// Вызывается до первого render, когда аккаунт ещё неизвестен, поэтому пилотный
// вариант здесь недоступен: его подключает AppLayout, как только auth вернул
// actor и allowlist можно проверить.
export function applyAppTheme(theme: AppTheme, monochromeIdentity = false) {
  applyThemeVariant(resolveThemeVariant(theme, false))
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('identity-monochrome-preview', monochromeIdentity)
  if (monochromeIdentity) applyMonochromeThemeColor(theme)
}

export function applyMonochromeThemeColor(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', MONOCHROME_THEME_COLOR[theme])
}

export function setAppTheme(theme: AppTheme, darkPilot = false) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Тема всё равно применяется на текущую сессию, даже если хранилище
    // браузера недоступно (например, в приватном WKWebView-контексте).
  }
  applyThemeVariant(resolveThemeVariant(theme, darkPilot))
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
