const COUNTER_ID = 111074543

type AuthenticatedUserRole = 'trainer' | 'client'

declare global {
  interface Window { ym?: (id: number, action: string, ...args: unknown[]) => void }
}

// Счётчик по умолчанию трекает только полную перезагрузку страницы. Роутер —
// SPA (react-router), поэтому переходы между экранами шлём вручную хитом.
export function trackPageView(url: string) {
  window.ym?.(COUNTER_ID, 'hit', url)
}

// Клики и другие внутристраничные действия — через JS-событие. Имя должно
// совпадать с целью «Целевое событие», заведённой в интерфейсе Метрики.
export function trackGoal(name: string) {
  window.ym?.(COUNTER_ID, 'reachGoal', name)
}

// Авторизованное открытие отделено от обычных pageview: первый hit счётчик
// отправляет до восстановления сессии. Аналитика не должна влиять на вход или UI.
export function trackAuthenticatedOpen(userId: string, role: AuthenticatedUserRole) {
  try {
    window.ym?.(COUNTER_ID, 'setUserID', userId)
    window.ym?.(COUNTER_ID, 'reachGoal', 'authenticated_open', { role })
  } catch {
    // Сбой или блокировка Метрики не должны влиять на работу Fit.
  }
}
