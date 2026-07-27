const COUNTER_ID = 111074543

declare global {
  interface Window { ym?: (id: number, action: string, ...args: unknown[]) => void }
}

// Счётчик по умолчанию трекает только полную перезагрузку страницы. Роутер —
// SPA (react-router), поэтому переходы между экранами шлём вручную хитом.
export function trackPageView(url: string) {
  window.ym?.(COUNTER_ID, 'hit', url)
}
