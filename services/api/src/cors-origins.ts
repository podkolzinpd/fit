const CAPACITOR_IOS_ORIGIN = 'capacitor://localhost'

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return []
  return value.split(/[;,]/).map((candidate) => {
    const origin = candidate.trim()
    if (origin === CAPACITOR_IOS_ORIGIN) return origin

    const url = new URL(origin)
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (url.origin !== origin || (url.protocol !== 'https:' && !localHttp)) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain HTTPS, exact localhost HTTP, or capacitor://localhost origins',
      )
    }
    return origin
  })
}
