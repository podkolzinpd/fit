import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'

import { YandexIdentityClient } from './auth/yandex-identity.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import { DatabasePilotEnroller } from './db/yandex-pilot-enrollment.js'
import { buildMigrationApp } from './migration-app.js'

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8080

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

const databaseConfig = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
if (databaseConfig === undefined) throw new Error('Migration database is required')

const migrationsDirectory = fileURLToPath(
  new URL('../db/migrations', import.meta.url),
)

const redactedMigrationLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const pilotEnrollmentEnabled = process.env.YANDEX_PILOT_ENROLLMENT_ENABLED === 'true'
if (pilotEnrollmentEnabled && process.env.APP_ENV !== 'stage') {
  throw new Error('Pilot enrollment can be enabled only in stage')
}
const pilotEnrollmentPool = pilotEnrollmentEnabled
  ? new PgDatabasePool(databaseConfig)
  : undefined
const yandexClientId = process.env.YANDEX_OAUTH_CLIENT_ID
if (pilotEnrollmentEnabled && yandexClientId === undefined) {
  throw new Error('YANDEX_OAUTH_CLIENT_ID is required for pilot enrollment')
}

const app = buildMigrationApp({
  ...(pilotEnrollmentPool === undefined || yandexClientId === undefined
    ? {}
    : {
        pilotEnrollment: {
          enroller: new DatabasePilotEnroller(pilotEnrollmentPool),
          identityProvider: new YandexIdentityClient({
            expectedClientId: yandexClientId,
          }),
        },
      }),
  runMigrations: async () => {
    const migrations = await runner({
      advisoryLockMode: 'fail',
      createMigrationsSchema: true,
      databaseUrl: databaseConfig,
      dir: migrationsDirectory,
      direction: 'up',
      logger: redactedMigrationLogger,
      migrationsSchema: 'app_private',
      migrationsTable: 'fit_migrations',
      verbose: false,
    })
    return migrations.map((migration) => migration.name)
  },
})

if (pilotEnrollmentPool !== undefined) {
  app.addHook('onClose', async () => pilotEnrollmentPool.end())
}

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'Migration server startup failed')
  process.exitCode = 1
}
