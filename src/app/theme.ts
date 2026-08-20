import { useSyncExternalStore } from 'react'

export type AppTheme = 'light' | 'dark'

// Пилотные палитры — не третья и не четвёртая тема, а вторые наборы значений
// для светлой и тёмной. Пользователь по-прежнему выбирает «светлая/тёмная»;
// какой из двух наборов токенов применить, решает allowlist, а не
// переключатель в профиле.
export type ThemeVariant = 'light' | 'light-pilot' | 'dark' | 'dark-pilot'

// Какие пилотные палитры открыты текущему аккаунту. Обе проверяются по
// отдельным allowlist, поэтому аккаунт может быть в одном пилоте и не быть в
// другом.
export interface ThemePilots {
  light?: boolean
  dark?: boolean
}

export const THEME_STORAGE_KEY = 'fit.appTheme'
const THEME_CHANGE_EVENT = 'fit-theme-change'

// Цвет системной панели браузера/WKWebView совпадает с фоном варианта, иначе
// над экраном остаётся полоса чужой палитры.
const THEME_COLOR: Record<ThemeVariant, string> = {
  light: '#f7f4ef',
  'light-pilot': '#ffffff',
  dark: '#15131a',
  'dark-pilot': '#000000',
}

// Светлый пилот отдаёт обе метки: его блок в CSS переопределяет только те
// значения, которые в макете отличаются от текущей светлой темы, и опирается на
// её структурные правила. Базовая тёмная тема живёт в `:root`, поэтому своего
// класса не имеет.
const THEME_VARIANT_CLASS: Record<ThemeVariant, string> = {
  light: 'theme-light',
  'light-pilot': 'theme-light theme-light-pilot',
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

export function resolveThemeVariant(theme: AppTheme, pilots: ThemePilots = {}): ThemeVariant {
  if (theme === 'light') return pilots.light ? 'light-pilot' : 'light'
  return pilots.dark ? 'dark-pilot' : 'dark'
}

export function themeVariantClass(variant: ThemeVariant): string {
  return THEME_VARIANT_CLASS[variant]
}

function variantClassList(variant: ThemeVariant): string[] {
  return THEME_VARIANT_CLASS[variant].split(' ').filter(Boolean)
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
  const classes = variantClassList(variant)
  root.classList.toggle('theme-light', classes.includes('theme-light'))
  root.classList.toggle('theme-light-pilot', classes.includes('theme-light-pilot'))
  root.classList.toggle('theme-dark-pilot', classes.includes('theme-dark-pilot'))
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[variant])
}

// Вызывается до первого render, когда аккаунт ещё неизвестен, поэтому пилотные
// варианты здесь недоступны: их подключает AppLayout, как только auth вернул
// actor и allowlist можно проверить.
export function applyAppTheme(theme: AppTheme) {
  applyThemeVariant(resolveThemeVariant(theme))
}

export function setAppTheme(theme: AppTheme, pilots: ThemePilots = {}) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Тема всё равно применяется на текущую сессию, даже если хранилище
    // браузера недоступно (например, в приватном WKWebView-контексте).
  }
  applyThemeVariant(resolveThemeVariant(theme, pilots))
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
