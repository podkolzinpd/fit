import { buildApp } from './app.js'
import { PgDatabasePool } from './db/pg-pool.js'

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
const app = buildApp(
  databasePool === undefined ? {} : { databasePool },
)

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'API startup failed')
  process.exitCode = 1
}
