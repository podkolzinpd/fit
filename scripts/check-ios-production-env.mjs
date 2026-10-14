import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

export function validateIosProductionEnv(environment) {
  const errors = []
  for (const key of ['VITE_YANDEX_APP_SESSION_ENABLED', 'VITE_YANDEX_MAIN_ROUTING_ENABLED',
    'VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'VITE_YANDEX_ONLY_AUTH_ENABLED']) {
    if (environment[key] !== 'true') errors.push(`${key} must be true`)
  }
  const apiBaseUrl = environment.VITE_YANDEX_API_BASE_URL?.trim()
  try {
    const url = new URL(apiBaseUrl)
    if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.origin !== apiBaseUrl?.replace(/\/$/, '')) errors.push('VITE_YANDEX_API_BASE_URL must be a remote HTTPS origin')
  } catch {
    errors.push('VITE_YANDEX_API_BASE_URL must be a remote HTTPS origin')
  }
  const clientId = environment.VITE_YANDEX_OAUTH_CLIENT_ID?.trim()
  if (!clientId || clientId.length > 200) errors.push('VITE_YANDEX_OAUTH_CLIENT_ID is missing or invalid')
  return errors
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = validateIosProductionEnv(loadEnv('production', process.cwd(), ''))
  if (errors.length > 0) {
    console.error(`iOS production build stopped: ${errors.join('; ')}`)
    process.exit(1)
  }
  console.log('iOS production environment is configured')
}
