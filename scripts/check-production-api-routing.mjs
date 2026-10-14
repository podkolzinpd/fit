import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const productionApiOrigin = 'https://api.fit-training.ru'

// DNS chooses the production provider. A native release must never pin a
// provider's technical hostname or silently select the legacy data backend.
export function validateProductionApiRouting(environment) {
  const errors = []
  if (environment.VITE_YANDEX_API_BASE_URL?.replace(/\/$/, '') !== productionApiOrigin) {
    errors.push('Production API must use the canonical API origin')
  }
  if (environment.VITE_SPEECHKIT_RELAY_URL && environment.VITE_SPEECHKIT_RELAY_URL !== 'wss://api.fit-training.ru/stt') {
    errors.push('Production speech must use the canonical authenticated relay')
  }
  for (const name of [
    'VITE_YANDEX_APP_SESSION_ENABLED', 'VITE_YANDEX_MAIN_ROUTING_ENABLED',
    'VITE_YANDEX_ONLY_AUTH_ENABLED', 'VITE_YANDEX_NATIVE_REGISTRATION_ENABLED',
  ]) {
    if (environment[name] !== 'true') errors.push(`${name} must be true`)
  }
  return errors
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateProductionApiRouting(process.env)
  if (errors.length) {
    console.error(errors.join('; '))
    process.exitCode = 1
  } else console.log('Canonical production API routing verified')
}
