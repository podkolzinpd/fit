import { readFileSync } from 'node:fs'

import type { PoolConfig } from 'pg'

type Environment = Readonly<Record<string, string | undefined>>

interface BuildDatabaseConnectionConfigOptions {
  environment?: Environment
  readCertificate?: (path: string) => string
}

const DEFAULT_CA_PATH = '/app/certs/yandex-cloud-ca.pem'
const CLOUDRU_STAGE_DATABASE_HOST = '10.70.10.67'

function parsePort(value: string, variableName: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variableName} must be an integer between 1 and 65535`)
  }
  return port
}

export function buildDatabaseConnectionConfig(
  prefix: 'DATABASE' | 'MIGRATION_DATABASE',
  options: BuildDatabaseConnectionConfigOptions = {},
): PoolConfig | undefined {
  const environment = options.environment ?? process.env
  const connectionString = environment[`${prefix}_URL`]
  const componentNames = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD'] as const
  const componentValues = componentNames.map(
    (name) => environment[`${prefix}_${name}`],
  )
  const hasComponents = componentValues.some((value) => value !== undefined)

  if (connectionString !== undefined && hasComponents) {
    throw new Error(`${prefix}_URL cannot be combined with component variables`)
  }
  if (connectionString !== undefined) return { connectionString }
  if (!hasComponents) return undefined

  const missing = componentNames.filter(
    (_name, index) => componentValues[index] === undefined,
  )
  if (missing.length > 0) {
    throw new Error(
      `${prefix} connection variables are incomplete: ${missing.join(', ')}`,
    )
  }

  const [host, port, database, user, password] = componentValues as [
    string,
    string,
    string,
    string,
    string,
  ]
  const sslMode = environment[`${prefix}_SSL_MODE`] ?? 'verify-full'
  if (sslMode !== 'verify-full' && sslMode !== 'require') {
    throw new Error(`${prefix}_SSL_MODE must be verify-full or require`)
  }
  if (sslMode === 'require' && (
    host !== CLOUDRU_STAGE_DATABASE_HOST || port !== '5432' || database !== 'fit'
  )) {
    throw new Error(`${prefix}_SSL_MODE=require is limited to the Cloud.ru stage database`)
  }
  const caPath = environment[`${prefix}_SSL_ROOT_CERT`] ?? DEFAULT_CA_PATH
  const readCertificate = options.readCertificate ?? ((path: string) => readFileSync(path, 'utf8'))

  return {
    host,
    port: parsePort(port, `${prefix}_PORT`),
    database,
    user,
    password,
    ssl: sslMode === 'require'
      ? { rejectUnauthorized: false }
      : { ca: readCertificate(caPath), rejectUnauthorized: true },
  }
}
