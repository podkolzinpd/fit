import { pathToFileURL } from 'node:url'

import { YandexSqlSnapshotSource, type SqlSnapshotManifest } from './cloudru-sql-snapshot.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'

const NAME = /^[a-z][a-z0-9_]*$/u
const DIGEST = /^[a-f0-9]{64}$/u
const SCHEMAS = ['app_private', 'private', 'public']

export function auditManifest(value: unknown): SqlSnapshotManifest {
  if (typeof value !== 'object' || value === null
    || !('format' in value) || value.format !== 'fit-cloudru-sql-snapshot-v1'
    || !('tables' in value) || !Array.isArray(value.tables)
    || value.tables.length < 1 || value.tables.length > 256) {
    throw new Error('audit_manifest_invalid')
  }
  const names = new Set<string>()
  const tables = value.tables.map((item: unknown) => {
    if (typeof item !== 'object' || item === null
      || !('schema' in item) || typeof item.schema !== 'string' || !SCHEMAS.includes(item.schema)
      || !('table' in item) || typeof item.table !== 'string' || !NAME.test(item.table)
      || (item.schema === 'app_private' && item.table === 'fit_migrations')
      || !('rows' in item) || typeof item.rows !== 'number'
      || !Number.isSafeInteger(item.rows) || item.rows < 0
      || !('sha256' in item) || typeof item.sha256 !== 'string' || !DIGEST.test(item.sha256)) {
      throw new Error('audit_manifest_invalid')
    }
    const name = `${item.schema}.${item.table}`
    if (names.has(name)) throw new Error('audit_manifest_invalid')
    names.add(name)
    return { schema: item.schema, table: item.table, rows: item.rows, sha256: item.sha256 }
  })
  return { format: 'fit-cloudru-sql-snapshot-v1', tables }
}

export function compareAuditManifests(source: SqlSnapshotManifest, target: SqlSnapshotManifest) {
  const sourceTables = new Map(source.tables.map((table) => [`${table.schema}.${table.table}`, table]))
  const targetTables = new Map(target.tables.map((table) => [`${table.schema}.${table.table}`, table]))
  const names = [...new Set([...sourceTables.keys(), ...targetTables.keys()])].sort()
  return names.flatMap((name) => {
    const left = sourceTables.get(name)
    const right = targetTables.get(name)
    if (left !== undefined && right !== undefined
      && left.rows === right.rows && left.sha256 === right.sha256) return []
    return [{ table: name, sourceRows: left?.rows ?? null, targetRows: right?.rows ?? null,
      reason: left === undefined || right === undefined ? 'table_missing' : 'content_differs' }]
  })
}

export async function readSourceAuditManifest(url: string, token: string,
  request: typeof fetch = fetch): Promise<SqlSnapshotManifest> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search
    || parsed.hash || !parsed.hostname.endsWith('.containers.yandexcloud.net')) {
    throw new Error('audit_source_url_invalid')
  }
  const response = await request(`${url.replace(/\/$/u, '')}/stage/cloudru/sql-snapshot/manifest`, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`,
      'x-fit-sql-snapshot-confirmation': 'READ_YANDEX_STAGE_SQL_SNAPSHOT' },
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok) throw new Error(`audit_source_http_${response.status}`)
  return auditManifest(await response.json())
}

export async function runSqlAudit(readSource: () => Promise<SqlSnapshotManifest>,
  readTarget: () => Promise<SqlSnapshotManifest>) {
  const before = auditManifest(await readSource())
  const target = auditManifest(await readTarget())
  const after = auditManifest(await readSource())
  const sourceChanged = compareAuditManifests(before, after).length > 0
  const differences = compareAuditManifests(after, target)
  return {
    event: 'cloudru_sql_readonly_audit',
    status: sourceChanged ? 'source_changed_during_audit' : differences.length ? 'different' : 'equal',
    sourceTables: after.tables.length,
    targetTables: target.tables.length,
    sourceRows: after.tables.reduce((sum, table) => sum + table.rows, 0),
    targetRows: target.tables.reduce((sum, table) => sum + table.rows, 0),
    differences,
    cutoverAuthorized: false,
  }
}

async function main(): Promise<void> {
  // Owner access is confined to a single bounded READ ONLY snapshot. Reuse the
  // existing transfer manifest algorithm so imported JSON/checksums agree.
  if (process.env.MIGRATION_DATABASE_HOST !== '10.70.10.67'
    || process.env.MIGRATION_DATABASE_PORT !== '5432'
    || process.env.MIGRATION_DATABASE_NAME !== 'fit'
    || process.env.MIGRATION_DATABASE_USER !== 'fit_owner'
    || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw new Error('audit_target_invalid')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  const url = process.env.FIT_SQL_SOURCE_URL
  const token = process.env.YC_IAM_TOKEN
  if (config === undefined || !url || !token) throw new Error('audit_config_missing')
  const pool = new PgDatabasePool({ ...config, max: 1, statement_timeout: 60_000,
    options: '-c default_transaction_read_only=on -c lock_timeout=2000',
  }, 'migration-owner')
  try {
    const report = await runSqlAudit(() => readSourceAuditManifest(url, token),
      () => new YandexSqlSnapshotSource(pool).manifest())
    process.stdout.write(`${JSON.stringify(report)}\n`)
    if (report.status !== 'equal') process.exitCode = 2
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error && /^audit_[a-z_]+(?:_[1-5][0-9]{2})?$/u.test(error.message)
      ? error.message : 'audit_failed'
    process.stderr.write(`${message}; no source or target rows were changed.\n`)
    process.exitCode = 1
  })
}
