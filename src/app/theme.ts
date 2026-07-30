export type AppTheme = 'light' | 'dark'

// Светлая тема прошла маршрутный пилот и теперь является основной. Тёмную
// сохраняем как безопасный build-time откат: VITE_APP_THEME=dark.
export function resolveAppTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export const APP_THEME = resolveAppTheme(import.meta.env.VITE_APP_THEME)
