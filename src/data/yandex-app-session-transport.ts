const STORAGE_KEY = 'fit.yandexAppSession.v1'
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type YandexAppSessionTransport = {
  apiBaseUrl: string
  sessionToken: string
}

/** Read the browser app-session issued by the Yandex API. */
export function yandexAppSessionTransport(): YandexAppSessionTransport | null {
  if (typeof window === 'undefined') return null
  const apiBaseUrl = String(import.meta.env.VITE_YANDEX_API_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (!apiBaseUrl) return null
  try {
    const url = new URL(apiBaseUrl)
    const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (url.protocol !== 'https:' && !localHttp) return null
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown }
    if (typeof value.token !== 'string' || !SESSION_TOKEN_PATTERN.test(value.token)) return null
    if (typeof value.expiresAt !== 'string' || Date.parse(value.expiresAt) <= Date.now()) return null
    return { apiBaseUrl, sessionToken: value.token }
  } catch {
    return null
  }
}
