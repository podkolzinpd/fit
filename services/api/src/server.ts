import { buildApp } from './app.js'
import { YandexIdentityClient } from './auth/yandex-identity.js'
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
const pilotProfileReader =
  databasePool === undefined
    ? undefined
    : new DatabasePilotProfileReader(databasePool)
const app = buildApp(
  {
    ...(databasePool === undefined ? {} : { databasePool }),
    ...(identityProvider === undefined ? {} : { identityProvider }),
    ...(pilotProfileReader === undefined ? {} : { pilotProfileReader }),
  },
)

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'API startup failed')
  process.exitCode = 1
}
