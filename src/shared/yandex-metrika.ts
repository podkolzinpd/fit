// Existing product counters retain their history. The owner's acquisition
// counter independently receives application activity as well as landing visits.
export const ACQUISITION_COUNTER_ID = 114123380
export const COUNTER_IDS = [111074543, 113121193, ACQUISITION_COUNTER_ID] as const

type AuthenticatedUserRole = 'trainer' | 'client'

declare global {
  interface Window { ym?: (id: number, action: string, ...args: unknown[]) => void }
}

export function sanitizeMetrikaUrl(rawUrl: string): string {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(rawUrl)
    const url = new URL(rawUrl, window.location.origin)
    const corporateInvitation = /^\/corporate-invite\/*$/i.test(decodeURIComponent(url.pathname))
    if (url.pathname === '/invite' || corporateInvitation) {
      url.searchParams.delete('token')
      url.searchParams.delete('source')
      const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
      if (hash.has('token') || hash.has('source')) url.hash = ''
    }
    return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

export function sanitizeAcquisitionUrl(rawUrl: string): string {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(rawUrl)
    const url = new URL(rawUrl, window.location.origin)
    const search = new URLSearchParams()
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = url.searchParams.get(key)
      if (value) search.set(key, value)
    }
    url.search = search.toString()
    url.hash = ''
    return absolute ? url.toString() : `${url.pathname}${url.search}`
  } catch {
    return '/'
  }
}

// Счётчик по умолчанию трекает только полную перезагрузку страницы. Роутер —
// SPA (react-router), поэтому переходы между экранами шлём вручную хитом.
export function trackPageView(url: string) {
  const safeUrl = sanitizeMetrikaUrl(url)
  for (const id of COUNTER_IDS) {
    try {
      window.ym?.(id, 'hit', id === ACQUISITION_COUNTER_ID ? sanitizeAcquisitionUrl(url) : safeUrl)
    } catch { /* A failed counter must not affect navigation or other counters. */ }
  }
}

// Клики и другие внутристраничные действия — через JS-событие. Имя должно
// совпадать с целью «Целевое событие», заведённой в интерфейсе Метрики.
export function trackGoal(name: string) {
  for (const id of COUNTER_IDS) {
    try { window.ym?.(id, 'reachGoal', name) } catch { /* Analytics is optional. */ }
  }
}

// The caller supplies a confirmed account role, never form or workout data.
export function trackAcquisitionGoal(
  name: 'registration_completed' | 'workout_result_saved',
  role: AuthenticatedUserRole,
) {
  try { window.ym?.(ACQUISITION_COUNTER_ID, 'reachGoal', name, { role }) } catch { /* Analytics is optional. */ }
}

// Авторизованное открытие отделено от обычных pageview: первый hit счётчик
// отправляет до восстановления сессии. Аналитика не должна влиять на вход или UI.
export function trackAuthenticatedOpen(userId: string, role: AuthenticatedUserRole) {
  for (const id of COUNTER_IDS) {
    try {
      window.ym?.(id, 'setUserID', userId)
      window.ym?.(id, 'reachGoal', 'authenticated_open', { role })
    } catch { /* A failed counter must not block identification in another. */ }
  }
}
