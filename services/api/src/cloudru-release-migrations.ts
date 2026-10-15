import { spawn } from 'node:child_process'
import { chmod, lstat, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PG_MIGRATE_LOCK_ID, runner } from 'node-pg-migrate'
import { Client, type ClientConfig } from 'pg'

import { buildDatabaseConnectionConfig } from './db/connection-config.js'

type Environment = Readonly<Record<string, string | undefined>>

class ReleaseMigrationError extends Error {}

export function cloudruMigrationConfig(environment: Environment): ClientConfig {
  if (environment.CLOUDRU_MIGRATION_CONFIRMATION !== 'APPLY_CLOUDRU_PENDING_MIGRATIONS'
    || !/^[a-f0-9]{40}$/u.test(environment.RELEASE_SHA ?? '')
    || environment.MIGRATION_DATABASE_URL !== undefined
    || environment.MIGRATION_DATABASE_HOST !== '10.70.10.67'
    || environment.MIGRATION_DATABASE_PORT !== '5432'
    || environment.MIGRATION_DATABASE_NAME !== 'fit'
    || environment.MIGRATION_DATABASE_USER !== 'fit_owner'
    || environment.MIGRATION_DATABASE_SSL_MODE !== 'require') {
    throw new ReleaseMigrationError('cloudru_migration_target_rejected')
  }
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE', { environment })
  if (config === undefined || !config.password) throw new ReleaseMigrationError('cloudru_migration_config_missing')
  return { ...config, connectionTimeoutMillis: 10_000, application_name: 'fit-cloudru-release-migrations' }
}

export function migrationFailureReason(error: unknown): string {
  return error instanceof ReleaseMigrationError ? error.message : 'cloudru_migration_failed'
}

export async function backupCloudruDatabase(config: ClientConfig, directory: string): Promise<void> {
  const archive = join(directory, 'before-migrations.dump')
  const checked = await stat(directory)
  if (!checked.isDirectory() || checked.uid !== 0 || (checked.mode & 0o077) !== 0) {
    throw new ReleaseMigrationError('cloudru_backup_directory_rejected')
  }
  try {
    await lstat(archive)
    throw new ReleaseMigrationError('cloudru_backup_already_exists')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--lock-wait-timeout=10s',
      '--file', archive], {
      env: {
        PATH: process.env.PATH,
        PGHOST: config.host,
        PGPORT: String(config.port),
        PGDATABASE: config.database,
        PGUSER: config.user,
        PGPASSWORD: typeof config.password === 'string' ? config.password : '',
        PGSSLMODE: 'require',
        PGCONNECT_TIMEOUT: '10',
      },
      stdio: 'ignore',
      timeout: 300_000,
    })
    child.once('error', () => { reject(new ReleaseMigrationError('cloudru_backup_failed')) })
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new ReleaseMigrationError('cloudru_backup_failed'))
    })
  })
  await chmod(archive, 0o600)
  const archiveStat = await stat(archive)
  if (!archiveStat.isFile() || archiveStat.uid !== 0 || (archiveStat.mode & 0o077) !== 0 || archiveStat.size === 0) {
    throw new ReleaseMigrationError('cloudru_backup_empty')
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_restore', ['--list', archive], { stdio: 'ignore', timeout: 30_000 })
    child.once('error', () => { reject(new ReleaseMigrationError('cloudru_backup_invalid')) })
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new ReleaseMigrationError('cloudru_backup_invalid'))
    })
  })
}

interface ReleaseMigrationContext {
  client: Client
  expectedDatabase: string
  expectedOwner: string
  directory: string
  backup: () => Promise<void>
}

export function assertTransactionalUpSql(contents: string): void {
  const up = contents.split(/^\s*--[\s-]*down\s+migration\b/imu)[0] ?? ''
  // Ignore quoted function bodies/identifiers/literals and comments. END in a
  // DO block is not a transaction boundary; an unquoted top-level END is.
  let statements = ''
  for (let i = 0; i < up.length;) {
    if (up.startsWith('--', i)) {
      const end = up.indexOf('\n', i + 2)
      i = end < 0 ? up.length : end + 1
    } else if (up.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < up.length && depth > 0) {
        if (up.startsWith('/*', i)) { depth++; i += 2 }
        else if (up.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth !== 0) throw new ReleaseMigrationError('cloudru_migration_transaction_rejected')
    } else if (up[i] === "'" || up[i] === '"') {
      const quote = up[i]
      const escaped = quote === "'" && /e$/iu.test(up.slice(0, i)) && !/[a-z0-9_$]/iu.test(up[i - 2] ?? '')
      let closed = false
      i++
      while (i < up.length) {
        if (escaped && up[i] === '\\') i += 2
        else if (up[i] === quote && up[i + 1] === quote) i += 2
        else if (up[i] === quote) { i++; closed = true; break }
        else i++
      }
      if (!closed) throw new ReleaseMigrationError('cloudru_migration_transaction_rejected')
    } else {
      const dollar = /^\$(?:[a-z_][a-z0-9_]*)?\$/iu.exec(up.slice(i))?.[0]
      if (dollar) {
        const end = up.indexOf(dollar, i + dollar.length)
        if (end < 0) throw new ReleaseMigrationError('cloudru_migration_transaction_rejected')
        i = end + dollar.length
      } else {
        statements += up[i]
        i++
        continue
      }
    }
    statements += ' '
  }
  if (/(?:^|;)\s*(?:begin|start\s+transaction|commit|end|rollback|abort|prepare\s+transaction)\b/iu.test(statements)) {
    throw new ReleaseMigrationError('cloudru_migration_transaction_rejected')
  }
}

async function executePending(context: ReleaseMigrationContext, connectionFailed: () => boolean): Promise<number> {
  const { client, directory } = context
  await client.query("set statement_timeout = '120s'")
  await client.query("set lock_timeout = '3s'")
  const identity = await client.query<{ owner: string; database: string; history: string | null }>(
    `select current_user as owner, current_database() as database,
      to_regclass('app_private.fit_migrations')::text as history`,
  )
  if (identity.rows[0]?.owner !== context.expectedOwner
    || identity.rows[0]?.database !== context.expectedDatabase || identity.rows[0]?.history == null) {
    throw new ReleaseMigrationError('cloudru_migration_identity_rejected')
  }
  const primaryKey = await client.query<{ count: number }>(
    "select count(*)::integer as count from pg_constraint where conrelid = 'app_private.fit_migrations'::regclass and contype = 'p'",
  )
  if (primaryKey.rows[0]?.count !== 1) throw new ReleaseMigrationError('cloudru_migration_history_rejected')
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some(entry => !entry.isFile() || !/^\d{6,8}_[a-z0-9_]+\.sql$/u.test(entry.name))) {
    throw new ReleaseMigrationError('cloudru_migration_directory_rejected')
  }
  const files = entries.map(entry => entry.name)
  const known = new Set(files.map(file => file.slice(0, -4)))
  const history = await client.query<{ name: string }>('select name from app_private.fit_migrations')
  if (history.rows.length === 0 || history.rows.some(row => !known.has(row.name))
    || new Set(history.rows.map(row => row.name)).size !== history.rows.length) {
    throw new ReleaseMigrationError('cloudru_migration_history_rejected')
  }
  const options = {
    dbClient: client,
    advisoryLockMode: 'fail' as const,
    checkOrder: false,
    createMigrationsSchema: false,
    dir: directory,
    direction: 'up' as const,
    singleTransaction: true,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    migrationsSchema: 'app_private',
    migrationsTable: 'fit_migrations',
    verbose: false,
  }
  const pending = await runner({ ...options, dryRun: true })
  for (const migration of pending) {
    const contents = await readFile(migration.path, 'utf8')
    if (!known.has(migration.name)) throw new ReleaseMigrationError('cloudru_migration_directory_rejected')
    assertTransactionalUpSql(contents)
  }
  if (pending.length === 0) return 0
  await context.backup()
  if (connectionFailed()) throw new ReleaseMigrationError('cloudru_migration_connection_lost')
  await client.query('select 1')
  const applied = await runner({ ...options, dryRun: false })
  if (applied.length !== pending.length || applied.some((migration, i) => migration.name !== pending[i]?.name)
    || (await runner({ ...options, dryRun: true })).length !== 0) {
    throw new ReleaseMigrationError('cloudru_migration_verification_failed')
  }
  return applied.length
}

// Keep the standard node-pg-migrate lock continuously across backup and apply.
// Cleanup failures stop the release without replacing an earlier failure.
export async function migrateCloudruRelease(context: ReleaseMigrationContext): Promise<number> {
  const { client } = context
  let locked = false
  let connectionFailed = false
  let failure: Error | undefined
  let applied = 0
  const onConnectionError = () => { connectionFailed = true }
  client.on('error', onConnectionError)
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock($1::bigint) as acquired', [String(PG_MIGRATE_LOCK_ID)],
    )
    if (lock.rows[0]?.acquired !== true) throw new ReleaseMigrationError('cloudru_migration_locked')
    locked = true
    applied = await executePending(context, () => connectionFailed)
  } catch (error) {
    failure = error instanceof Error ? error : new ReleaseMigrationError('cloudru_migration_failed')
  } finally {
    try {
      if (locked && !connectionFailed) {
        const released = await client.query<{ released: boolean }>(
          'select pg_advisory_unlock($1::bigint) as released', [String(PG_MIGRATE_LOCK_ID)],
        )
        if (released.rows[0]?.released !== true) failure ??= new ReleaseMigrationError('cloudru_migration_unlock_failed')
      }
      if (connectionFailed) failure ??= new ReleaseMigrationError('cloudru_migration_connection_lost')
    } catch (error) {
      failure ??= error instanceof Error ? error : new ReleaseMigrationError('cloudru_migration_unlock_failed')
    }
    client.off('error', onConnectionError)
  }
  if (failure !== undefined) throw failure
  return applied
}

async function main(): Promise<void> {
  const config = cloudruMigrationConfig(process.env)
  const client = new Client(config)
  let connectionFailed = false
  let applied: number
  client.on('error', () => { connectionFailed = true })
  try {
    await client.connect()
    applied = await migrateCloudruRelease({ client, expectedDatabase: 'fit', expectedOwner: 'fit_owner',
      directory: fileURLToPath(new URL('../db/migrations', import.meta.url)),
      backup: () => backupCloudruDatabase(config, '/backup') })
  } finally {
    await client.end()
  }
  if (connectionFailed) throw new ReleaseMigrationError('cloudru_migration_connection_lost')
  process.stdout.write(JSON.stringify({ event: 'cloudru_release_migrations_verified', applied }) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ event: 'cloudru_release_migrations_failed', reason: migrationFailureReason(error) }) + '\n')
    process.exitCode = 1
  })
}
