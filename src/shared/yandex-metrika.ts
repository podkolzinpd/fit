// Переходный период: пишем и в счётчик с историей, и в новый счётчик
// fit-training.ru. Список должен совпадать с init в index.html.
export const COUNTER_IDS = [111074543, 113121193] as const

type AuthenticatedUserRole = 'trainer' | 'client'

declare global {
  interface Window { ym?: (id: number, action: string, ...args: unknown[]) => void }
}

// Счётчик по умолчанию трекает только полную перезагрузку страницы. Роутер —
// SPA (react-router), поэтому переходы между экранами шлём вручную хитом.
export function trackPageView(url: string) {
  for (const id of COUNTER_IDS) window.ym?.(id, 'hit', url)
}

// Клики и другие внутристраничные действия — через JS-событие. Имя должно
// совпадать с целью «Целевое событие», заведённой в интерфейсе Метрики.
export function trackGoal(name: string) {
  for (const id of COUNTER_IDS) window.ym?.(id, 'reachGoal', name)
}

// Авторизованное открытие отделено от обычных pageview: первый hit счётчик
// отправляет до восстановления сессии. Аналитика не должна влиять на вход или UI.
export function trackAuthenticatedOpen(userId: string, role: AuthenticatedUserRole) {
  try {
    for (const id of COUNTER_IDS) {
      window.ym?.(id, 'setUserID', userId)
      window.ym?.(id, 'reachGoal', 'authenticated_open', { role })
    }
  } catch {
    // Сбой или блокировка Метрики не должны влиять на работу Fit.
  }
}
