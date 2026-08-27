import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'

import { YandexIdentityClient } from './auth/yandex-identity.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import { inspectRuntimeDomainReadiness } from './db/runtime-domain-readiness.js'
import { DatabaseStageDatabaseReaderAccessManager } from './db/stage-database-reader-access.js'
import { DatabaseStageWorkoutFixtureLoader } from './db/stage-workout-fixture.js'
import { DatabasePilotEnroller } from './db/yandex-pilot-enrollment.js'
import { buildMigrationApp } from './migration-app.js'
import { DatabasePilotClientsReader } from './pilot-clients-reader.js'
import { DatabasePilotConnectionsReader } from './pilot-connections-reader.js'
import { DatabasePilotTrainingDataReader } from './pilot-training-data-reader.js'

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
const stageWorkoutFixtureEnabled =
  process.env.STAGE_WORKOUT_FIXTURES_ENABLED === 'true'
if (stageWorkoutFixtureEnabled && process.env.APP_ENV !== 'stage') {
  throw new Error('Stage workout fixtures can be enabled only in stage')
}
const stageDatabaseAccessEnabled =
  process.env.STAGE_DATABASE_ACCESS_ENABLED === 'true'
if (stageDatabaseAccessEnabled && process.env.APP_ENV !== 'stage') {
  throw new Error('Stage database access can be enabled only in stage')
}
const stageRuntimeDatabasePreflightEnabled =
  process.env.STAGE_RUNTIME_DATABASE_PREFLIGHT_ENABLED === 'true'
if (stageRuntimeDatabasePreflightEnabled && process.env.APP_ENV !== 'stage') {
  throw new Error('Runtime database preflight can be enabled only in stage')
}
const privateFeaturePool = pilotEnrollmentEnabled
  || stageWorkoutFixtureEnabled
  || stageDatabaseAccessEnabled
  ? new PgDatabasePool(databaseConfig)
  : undefined
const runtimeDatabaseConfig = stageRuntimeDatabasePreflightEnabled
  ? buildDatabaseConnectionConfig('DATABASE')
  : undefined
if (stageRuntimeDatabasePreflightEnabled && runtimeDatabaseConfig === undefined) {
  throw new Error('Runtime database is required for stage preflight')
}
const runtimeDatabasePool = runtimeDatabaseConfig === undefined
  ? undefined
  : new PgDatabasePool(runtimeDatabaseConfig)
const runtimeClientsReader = runtimeDatabasePool === undefined
  ? undefined
  : new DatabasePilotClientsReader(runtimeDatabasePool)
const runtimeConnectionsReader = runtimeDatabasePool === undefined
  ? undefined
  : new DatabasePilotConnectionsReader(runtimeDatabasePool)
const runtimeTrainingDataReader = runtimeDatabasePool === undefined
  ? undefined
  : new DatabasePilotTrainingDataReader(runtimeDatabasePool)
const yandexClientId = process.env.YANDEX_OAUTH_CLIENT_ID
if (pilotEnrollmentEnabled && yandexClientId === undefined) {
  throw new Error('YANDEX_OAUTH_CLIENT_ID is required for pilot enrollment')
}

const app = buildMigrationApp({
  ...(privateFeaturePool === undefined || !stageDatabaseAccessEnabled
    ? {}
    : {
        databaseReaderAccess:
          new DatabaseStageDatabaseReaderAccessManager(privateFeaturePool),
      }),
  ...(privateFeaturePool === undefined || yandexClientId === undefined
    ? {}
    : {
        pilotEnrollment: {
          enroller: new DatabasePilotEnroller(privateFeaturePool),
          identityProvider: new YandexIdentityClient({
            expectedClientId: yandexClientId,
          }),
        },
      }),
  ...(privateFeaturePool === undefined || !stageWorkoutFixtureEnabled
    ? {}
    : {
        stageWorkoutFixture: new DatabaseStageWorkoutFixtureLoader(
          privateFeaturePool,
        ),
      }),
  ...(runtimeClientsReader === undefined
    || runtimeConnectionsReader === undefined
    || runtimeTrainingDataReader === undefined
    ? {}
    : {
        runtimeDatabaseReadiness: (sessionToken: string) =>
          inspectRuntimeDomainReadiness(
            runtimeClientsReader,
            runtimeConnectionsReader,
            runtimeTrainingDataReader,
            sessionToken,
          ),
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

if (privateFeaturePool !== undefined || runtimeDatabasePool !== undefined) {
  app.addHook('onClose', async () => {
    await Promise.all([
      privateFeaturePool?.end(),
      runtimeDatabasePool?.end(),
    ])
  })
}

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'Migration server startup failed')
  process.exitCode = 1
}
