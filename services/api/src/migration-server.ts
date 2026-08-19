import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'

import { buildDatabaseConnectionConfig } from './db/connection-config.js'
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

const app = buildMigrationApp({
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

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'Migration server startup failed')
  process.exitCode = 1
}
