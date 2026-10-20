export function legacyCloudApiBaseUrl(): string | undefined {
  const value = String((import.meta.env as { VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL?: unknown }).VITE_YANDEX_LEGACY_FUNCTIONS_API_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (value.length === 0) return undefined
  try {
    const url = new URL(value)
    const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    return url.origin === value && (url.protocol === 'https:' || localHttp) ? value : undefined
  } catch {
    return undefined
  }
}
