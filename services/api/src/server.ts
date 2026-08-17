import { buildApp } from './app.js'
import { YandexIdentityClient } from './auth/yandex-identity.js'
import { YandexOAuthCodeClient } from './auth/yandex-oauth-code.js'
import { PgDatabasePool } from './db/pg-pool.js'
import { DatabasePilotProfileReader } from './pilot-profile-reader.js'

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8080

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return []
  return value.split(',').map((candidate) => {
    const origin = candidate.trim()
    const url = new URL(origin)
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (url.origin !== origin || (url.protocol !== 'https:' && !localHttp)) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain comma-separated HTTP origins')
    }
    return origin
  })
}

const databasePool =
  process.env.DATABASE_URL === undefined
    ? undefined
    : new PgDatabasePool({ connectionString: process.env.DATABASE_URL })
const identityProvider =
  process.env.YANDEX_OAUTH_CLIENT_ID === undefined
    ? undefined
    : new YandexIdentityClient({
        expectedClientId: process.env.YANDEX_OAUTH_CLIENT_ID,
      })
const oauthCodeProvider =
  process.env.YANDEX_OAUTH_CLIENT_ID === undefined
    ? undefined
    : new YandexOAuthCodeClient({ clientId: process.env.YANDEX_OAUTH_CLIENT_ID })
const pilotProfileReader =
  databasePool === undefined
    ? undefined
    : new DatabasePilotProfileReader(databasePool)
const app = buildApp(
  {
    allowedOrigins: parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
    ...(databasePool === undefined ? {} : { databasePool }),
    ...(identityProvider === undefined ? {} : { identityProvider }),
    ...(oauthCodeProvider === undefined ? {} : { oauthCodeProvider }),
    ...(pilotProfileReader === undefined ? {} : { pilotProfileReader }),
  },
)

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'API startup failed')
  process.exitCode = 1
}
