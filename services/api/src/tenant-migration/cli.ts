import { readFile, open, unlink, type FileHandle } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

import type { PoolConfig } from 'pg'

import { PgDatabasePool } from '../db/pg-pool.js'
import {
  decryptMigrationBundle,
  encryptMigrationBundle,
  TenantMigrationArtifactError,
} from './bundle.js'
import {
  parseTenantMigrationCliOptions,
  TenantMigrationCliOptionsError,
  type TenantMigrationCliOptions,
} from './cli-options.js'
import {
  exportTenant,
  importTenant,
  TenantMigrationError,
  validateTenant,
} from './engine.js'
import type {
  TenantMigrationBundle,
  TenantMigrationEnvelope,
  TenantMigrationReport,
} from './types.js'

type Environment = Readonly<Record<string, string | undefined>>

const REMOTE_CONFIRMATION = 'I_UNDERSTAND_REMOTE_DATABASE_ACCESS'
const REMOTE_APPLY_CONFIRMATION = 'APPLY_TENANT_TO_YANDEX_POSTGRES'

class TenantMigrationRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TenantMigrationRuntimeError'
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
}

function buildPoolConfig(
  variableName: 'FIT_TENANT_SOURCE_DATABASE_URL' | 'FIT_TENANT_TARGET_DATABASE_URL',
  options: TenantMigrationCliOptions,
  environment: Environment,
): { config: PoolConfig; remote: boolean } {
  const connectionString = environment[variableName]
  if (connectionString === undefined) {
    throw new TenantMigrationRuntimeError('database_url_required')
  }
  let parsed: URL
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new TenantMigrationRuntimeError('database_url_invalid')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new TenantMigrationRuntimeError('database_url_invalid')
  }
  if (isLocalHostname(parsed.hostname)) {
    return { config: { connectionString }, remote: false }
  }
  if (
    !options.allowRemote
    || environment.FIT_TENANT_REMOTE_CONFIRMATION !== REMOTE_CONFIRMATION
  ) throw new TenantMigrationRuntimeError('remote_database_not_confirmed')

  const certificatePath = variableName === 'FIT_TENANT_SOURCE_DATABASE_URL'
    ? environment.FIT_TENANT_SOURCE_SSL_ROOT_CERT
    : environment.FIT_TENANT_TARGET_SSL_ROOT_CERT
  if (certificatePath === undefined) {
    throw new TenantMigrationRuntimeError('remote_ssl_certificate_required')
  }
  return {
    remote: true,
    config: {
      connectionString,
      ssl: {
        ca: readFileSync(certificatePath, 'utf8'),
        rejectUnauthorized: true,
      },
    },
  }
}

function requirePassphrase(environment: Environment): string {
  const passphrase = environment.FIT_TENANT_MIGRATION_PASSPHRASE
  if (passphrase === undefined) {
    throw new TenantMigrationRuntimeError('passphrase_required')
  }
  return passphrase
}

async function writeEnvelope(
  artifactPath: string,
  envelope: TenantMigrationEnvelope,
): Promise<void> {
  let handle: FileHandle | undefined
  let created = false
  try {
    handle = await open(artifactPath, 'wx', 0o600)
    created = true
    await handle.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle?.close()
    handle = undefined
    if (created) {
      try {
        await unlink(artifactPath)
      } catch {
        throw new TenantMigrationRuntimeError('artifact_cleanup_failed')
      }
    }
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'EEXIST'
    ) throw new TenantMigrationRuntimeError('artifact_already_exists')
    throw new TenantMigrationRuntimeError('artifact_write_failed')
  } finally {
    await handle?.close()
  }
}

async function readBundle(
  artifactPath: string,
  passphrase: string,
): Promise<TenantMigrationBundle> {
  try {
    const contents = await readFile(artifactPath, 'utf8')
    return await decryptMigrationBundle(JSON.parse(contents), passphrase)
  } catch (error) {
    if (error instanceof TenantMigrationArtifactError) throw error
    throw new TenantMigrationRuntimeError('artifact_read_failed')
  }
}

function printReport(report: TenantMigrationReport): void {
  process.stdout.write(
    `${report.mode}: tenant ${report.tenantFingerprint}; ${report.tables.length} tables\n`,
  )
  for (const table of report.tables) {
    process.stdout.write(
      `${table.name}: rows=${table.rows}, inserted=${table.inserted}\n`,
    )
  }
}

async function withDatabase<Result>(
  config: PoolConfig,
  action: (connection: Awaited<ReturnType<PgDatabasePool['connect']>>) => Promise<Result>,
): Promise<Result> {
  const pool = new PgDatabasePool(config)
  let connection: Awaited<ReturnType<PgDatabasePool['connect']>> | undefined
  try {
    connection = await pool.connect()
    return await action(connection)
  } finally {
    connection?.release()
    await pool.end()
  }
}

async function run(options: TenantMigrationCliOptions): Promise<void> {
  const environment = process.env
  const passphrase = requirePassphrase(environment)

  if (options.command === 'export') {
    const database = buildPoolConfig(
      'FIT_TENANT_SOURCE_DATABASE_URL',
      options,
      environment,
    )
    const bundle = await withDatabase(database.config, (connection) =>
      exportTenant(connection, options.trainerId),
    )
    const envelope = await encryptMigrationBundle(bundle, passphrase)
    await writeEnvelope(options.artifactPath, envelope)
    process.stdout.write(
      `exported: tenant ${bundle.tenantFingerprint}; ${bundle.tables.length} tables\n`,
    )
    for (const table of bundle.tables) {
      process.stdout.write(`${table.name}: rows=${table.rowCount}\n`)
    }
    return
  }

  const bundle = await readBundle(options.artifactPath, passphrase)
  const database = buildPoolConfig(
    'FIT_TENANT_TARGET_DATABASE_URL',
    options,
    environment,
  )
  if (
    options.command === 'import'
    && options.apply
    && database.remote
    && environment.FIT_TENANT_REMOTE_APPLY_CONFIRMATION !== REMOTE_APPLY_CONFIRMATION
  ) throw new TenantMigrationRuntimeError('remote_apply_not_confirmed')
  const report = await withDatabase(database.config, (connection) =>
    options.command === 'import'
      ? importTenant(connection, bundle, options.apply)
      : validateTenant(connection, bundle),
  )
  printReport(report)
}

const USAGE = `Usage:
  npm run tenant:migrate -- export --trainer-id <uuid> --out <artifact>
  npm run tenant:migrate -- import --in <artifact> [--apply]
  npm run tenant:migrate -- validate --in <artifact>
Remote access additionally requires --allow-remote and explicit environment confirmations.\n`

try {
  const options = parseTenantMigrationCliOptions(process.argv.slice(2))
  await run(options)
} catch (error) {
  const code = error instanceof TenantMigrationArtifactError
    || error instanceof TenantMigrationCliOptionsError
    || error instanceof TenantMigrationError
    || error instanceof TenantMigrationRuntimeError
    ? error.code
    : 'unexpected_failure'
  process.stderr.write(`Tenant migration failed: ${code}\n${USAGE}`)
  process.exitCode = 1
}
