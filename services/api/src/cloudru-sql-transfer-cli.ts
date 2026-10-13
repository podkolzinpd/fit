import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { decryptDatabaseDump } from './cloud-database-transfer.js'
import type { SqlSnapshotManifest, SqlSnapshotTable } from './cloudru-sql-snapshot.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import type { DatabaseConnection } from './db/types.js'

interface NameRow { schema: string; table: string }
interface DataRow { row: string }
interface ColumnRow { column: string; identity: string }
interface IdentityColumnRow { schema: string; table: string; column: string }
interface ForeignKeyRow {
  childSchema: string
  childTable: string
  parentSchema: string
  parentTable: string
}

const NAME = /^[a-z][a-z0-9_]*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const CONFIRMATION = 'READ_YANDEX_STAGE_SQL_SNAPSHOT'
const SAFE_TRANSFER_MESSAGE = /^(?:source manifest HTTP [1-5][0-9]{2}|source chunk HTTP [1-5][0-9]{2}|sql_chunk_too_large|source rows changed during download|source changed during download|source changed before apply|source and target table sets differ|target is not empty|saved row count mismatch|non-deferrable foreign-key cycle|invalid source chunk|invalid saved chunk|source checksum changed for (?:app_private|private|public)\.[a-z][a-z0-9_]*|target checksum mismatch for (?:app_private|private|public)\.[a-z][a-z0-9_]*)$/u
let transferPhase = 'startup'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} missing`)
  return value
}

function reference(schema: string, table: string): string {
  if (!NAME.test(schema) || !NAME.test(table)
    || !['app_private', 'private', 'public'].includes(schema)) {
    throw new Error('invalid snapshot table name')
  }
  return `"${schema}"."${table}"`
}

function validatedManifest(value: unknown): SqlSnapshotManifest {
  if (typeof value !== 'object' || value === null
    || !('format' in value) || value.format !== 'fit-cloudru-sql-snapshot-v1'
    || !('tables' in value) || !Array.isArray(value.tables)) {
    throw new Error('invalid source manifest')
  }
  const tables: SqlSnapshotTable[] = []
  const names = new Set<string>()
  for (const item of value.tables as unknown[]) {
    if (typeof item !== 'object' || item === null
      || !('schema' in item) || !('table' in item)
      || !('rows' in item) || !('sha256' in item)
      || typeof item.schema !== 'string' || typeof item.table !== 'string'
      || typeof item.rows !== 'number' || typeof item.sha256 !== 'string'
      || !Number.isSafeInteger(item.rows) || item.rows < 0
      || !SHA256.test(item.sha256)) throw new Error('invalid source manifest table')
    reference(item.schema, item.table)
    const name = `${item.schema}.${item.table}`
    if (names.has(name)) throw new Error('duplicate source table')
    names.add(name)
    tables.push({
      schema: item.schema,
      table: item.table,
      rows: item.rows,
      sha256: item.sha256,
    })
  }
  if (tables.length < 1 || tables.length > 256) throw new Error('invalid source table count')
  return { format: 'fit-cloudru-sql-snapshot-v1', tables }
}

async function sourceRequest(
  url: string,
  token: string,
  path: string,
  body?: object,
  passphrase?: string,
): Promise<Response> {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-fit-sql-snapshot-confirmation': CONFIRMATION,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(passphrase === undefined ? {} : { 'x-fit-sql-snapshot-passphrase': passphrase }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(300_000),
  })
  return response
}

async function fetchManifest(url: string, token: string): Promise<SqlSnapshotManifest> {
  const response = await sourceRequest(url, token, '/stage/cloudru/sql-snapshot/manifest')
  if (!response.ok) throw new Error(`source manifest HTTP ${response.status}`)
  return validatedManifest(await response.json())
}

async function fetchChunk(
  url: string,
  token: string,
  passphrase: string,
  table: SqlSnapshotTable,
  offset: number,
  limit: number,
): Promise<{ encrypted: Buffer; rows: string[] }> {
  const response = await sourceRequest(url, token, '/stage/cloudru/sql-snapshot/chunk',
    { schema: table.schema, table: table.table, offset, limit }, passphrase)
  if (response.status === 409) {
    const rejection: unknown = await response.json()
    if (typeof rejection === 'object' && rejection !== null
      && 'code' in rejection && rejection.code === 'sql_chunk_too_large') {
      throw new Error('sql_chunk_too_large')
    }
  }
  if (!response.ok) throw new Error(`source chunk HTTP ${response.status}`)
  const encrypted = Buffer.from(await response.arrayBuffer())
  const raw: unknown = JSON.parse(gunzipSync(
    await decryptDatabaseDump(encrypted, passphrase),
  ).toString('utf8'))
  if (typeof raw !== 'object' || raw === null
    || !('format' in raw) || raw.format !== 'fit-cloudru-sql-chunk-v1'
    || !('schema' in raw) || raw.schema !== table.schema
    || !('table' in raw) || raw.table !== table.table
    || !('offset' in raw) || raw.offset !== offset
    || !('rows' in raw) || !Array.isArray(raw.rows)
    || raw.rows.length > limit
    || !raw.rows.every((row: unknown) => typeof row === 'string')) {
    throw new Error('invalid source chunk')
  }
  return { encrypted, rows: raw.rows }
}

async function downloadSnapshot(
  manifest: SqlSnapshotManifest,
  url: string,
  token: string,
  passphrase: string,
  directory: string,
  onTable: (table: SqlSnapshotTable) => void,
): Promise<Map<string, string[]>> {
  const files = new Map<string, string[]>()
  for (const [tableIndex, table] of manifest.tables.entries()) {
    onTable(table)
    const hash = createHash('sha256')
    const tableFiles: string[] = []
    let offset = 0
    while (offset < table.rows) {
      let limit = Math.min(500, table.rows - offset)
      let chunk: { encrypted: Buffer; rows: string[] }
      for (;;) {
        try {
          chunk = await fetchChunk(url, token, passphrase, table, offset, limit)
          break
        } catch (error) {
          if (error instanceof Error && error.message === 'sql_chunk_too_large' && limit > 1) {
            limit = Math.ceil(limit / 2)
            continue
          }
          throw error
        }
      }
      if (chunk.rows.length === 0) throw new Error('source rows changed during download')
      for (const row of chunk.rows) hash.update(row).update('\n')
      const path = join(directory, `${tableIndex}-${offset}.aes`)
      await writeFile(path, chunk.encrypted, { mode: 0o600 })
      tableFiles.push(path)
      offset += chunk.rows.length
    }
    if (hash.digest('hex') !== table.sha256) {
      throw new Error(`source checksum changed for ${table.schema}.${table.table}`)
    }
    files.set(`${table.schema}.${table.table}`, tableFiles)
  }
  return files
}

async function targetTables(connection: DatabaseConnection): Promise<readonly NameRow[]> {
  return connection.query<NameRow>(`select schemaname as schema, relname as table
    from pg_stat_user_tables
    where schemaname in ('app_private', 'private', 'public')
      and not (schemaname = 'app_private' and relname = 'fit_migrations')
    order by schemaname, relname`)
}

async function insertionOrder(
  connection: DatabaseConnection,
  manifest: SqlSnapshotManifest,
): Promise<SqlSnapshotTable[]> {
  const constraints = await connection.query<ForeignKeyRow>(`select
      child_namespace.nspname as "childSchema", child.relname as "childTable",
      parent_namespace.nspname as "parentSchema", parent.relname as "parentTable"
    from pg_constraint constraint_row
    join pg_class child on child.oid = constraint_row.conrelid
    join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
    join pg_class parent on parent.oid = constraint_row.confrelid
    join pg_namespace parent_namespace on parent_namespace.oid = parent.relnamespace
    where constraint_row.contype = 'f' and not constraint_row.condeferrable`)
  const remaining = new Map(manifest.tables.map((table) =>
    [`${table.schema}.${table.table}`, table]))
  const ordered: SqlSnapshotTable[] = []
  while (remaining.size > 0) {
    const ready = [...remaining.keys()].filter((name) =>
      !constraints.some((edge) =>
        `${edge.childSchema}.${edge.childTable}` === name
        && `${edge.parentSchema}.${edge.parentTable}` !== name
        && remaining.has(`${edge.parentSchema}.${edge.parentTable}`)))
    if (ready.length === 0) throw new Error('non-deferrable foreign-key cycle')
    for (const name of ready.sort()) {
      const table = remaining.get(name)
      if (table === undefined) throw new Error('snapshot table missing')
      ordered.push(table)
      remaining.delete(name)
    }
  }
  return ordered
}

async function savedRows(paths: readonly string[], passphrase: string): Promise<string[]> {
  const rows: string[] = []
  for (const path of paths) {
    const raw: unknown = JSON.parse(gunzipSync(
      await decryptDatabaseDump(await readFile(path), passphrase),
    ).toString('utf8'))
    if (typeof raw !== 'object' || raw === null
      || !('rows' in raw) || !Array.isArray(raw.rows)
      || !raw.rows.every((row: unknown) => typeof row === 'string')) {
      throw new Error('invalid saved chunk')
    }
    rows.push(...raw.rows)
  }
  return rows
}

async function verifyTable(
  connection: DatabaseConnection,
  table: SqlSnapshotTable,
): Promise<void> {
  const referenceName = reference(table.schema, table.table)
  const rows = await connection.query<DataRow>(
    `select row_to_json(record)::text as row from ${referenceName} record
      order by row_to_json(record)::text collate "C"`,
  )
  const hash = createHash('sha256')
  for (const entry of rows) hash.update(entry.row).update('\n')
  if (rows.length !== table.rows || hash.digest('hex') !== table.sha256) {
    throw new Error(`target checksum mismatch for ${table.schema}.${table.table}`)
  }
}

async function synchronizeIdentitySequences(connection: DatabaseConnection): Promise<void> {
  const identities = await connection.query<IdentityColumnRow>(`select
      namespace.nspname as schema, relation.relname as table,
      attribute.attname as column
    from pg_attribute attribute
    join pg_class relation on relation.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app_private', 'private', 'public')
      and attribute.attidentity <> '' and attribute.attnum > 0
      and not attribute.attisdropped`)
  for (const identity of identities) {
    const relation = reference(identity.schema, identity.table)
    const column = `"${identity.column.replaceAll('"', '""')}"`
    const values = await connection.query<{ maximum: string | null }>(
      `select max(${column})::text as maximum from ${relation}`,
    )
    const maximum = values[0]?.maximum
    if (maximum === null || maximum === undefined) continue
    const names = await connection.query<{ sequence: string | null }>(
      'select pg_get_serial_sequence($1, $2) as sequence',
      [`${identity.schema}.${identity.table}`, identity.column],
    )
    const sequence = names[0]?.sequence
    if (sequence === null || sequence === undefined) {
      throw new Error('identity sequence missing')
    }
    await connection.query('select setval($1::regclass, $2::bigint, true)',
      [sequence, maximum])
  }
}

async function restore(
  connection: DatabaseConnection,
  manifest: SqlSnapshotManifest,
  files: Map<string, string[]>,
  passphrase: string,
  apply: boolean,
): Promise<void> {
  await connection.query('begin')
  try {
    await connection.query("set local timezone to 'UTC'")
    await connection.query("set local bytea_output to 'hex'")
    await connection.query('set constraints all deferred')
    const actual = await targetTables(connection)
    const expectedNames = manifest.tables.map((item) => `${item.schema}.${item.table}`).sort()
    const actualNames = actual.map((item) => `${item.schema}.${item.table}`).sort()
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      throw new Error('source and target table sets differ')
    }
    for (const table of manifest.tables) {
      const rows = await connection.query<{ count: string }>(
        `select count(*)::text as count from ${reference(table.schema, table.table)}`,
      )
      if (rows[0]?.count !== '0') throw new Error('target is not empty')
    }
    for (const table of await insertionOrder(connection, manifest)) {
      if (table.rows === 0) continue
      const referenceName = reference(table.schema, table.table)
      const columns = await connection.query<ColumnRow>(`select attname as column,
          attidentity as identity
        from pg_attribute
        where attrelid = $1::regclass and attnum > 0
          and not attisdropped and attgenerated = ''
        order by attnum`, [`${table.schema}.${table.table}`])
      if (columns.length === 0) throw new Error('target table has no writable columns')
      const names = columns.map((item) => `"${item.column.replaceAll('"', '""')}"`)
      const overriding = columns.some((item) => item.identity === 'a')
        ? ' overriding system value' : ''
      const data = await savedRows(files.get(`${table.schema}.${table.table}`) ?? [], passphrase)
      if (data.length !== table.rows) throw new Error('saved row count mismatch')
      await connection.query(
        `insert into ${referenceName} (${names.join(',')})${overriding}
          select ${names.map((name) => `record.${name}`).join(',')}
          from jsonb_populate_recordset(null::${referenceName}, $1::jsonb) record`,
        [`[${data.join(',')}]`],
      )
    }
    for (const table of manifest.tables) await verifyTable(connection, table)
    if (apply) await synchronizeIdentitySequences(connection)
    await connection.query(apply ? 'commit' : 'rollback')
  } catch (error) {
    await connection.query('rollback').catch(() => undefined)
    throw error
  }
}

async function main(): Promise<void> {
  const mode = required('FIT_SQL_SNAPSHOT_MODE')
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error('invalid snapshot mode')
  const url = required('FIT_SQL_SOURCE_URL').replace(/\/$/u, '')
  if (!/^https:\/\/[a-z0-9-]+\.containers\.yandexcloud\.net$/u.test(url)) {
    throw new Error('invalid private source URL')
  }
  const token = required('YC_IAM_TOKEN')
  const passphrase = required('FIT_SQL_SNAPSHOT_PASSPHRASE')
  if (passphrase.length < 32) throw new Error('snapshot passphrase too short')
  const databaseConfig = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (databaseConfig === undefined) throw new Error('target database config missing')
  const pool = new PgDatabasePool(databaseConfig, 'migration-owner')
  const directory = await mkdtemp(join(tmpdir(), `fit-sql-${randomBytes(4).toString('hex')}-`))
  try {
    transferPhase = 'source-manifest'
    const manifest = await fetchManifest(url, token)
    const files = await downloadSnapshot(manifest, url, token, passphrase, directory,
      (table) => { transferPhase = `download:${table.schema}.${table.table}` })
    transferPhase = 'source-recheck'
    const afterDownload = await fetchManifest(url, token)
    if (JSON.stringify(afterDownload) !== JSON.stringify(manifest)) {
      throw new Error('source changed during download')
    }
    transferPhase = 'target-connect'
    const connection = await pool.connect()
    try {
      transferPhase = 'target-rehearsal'
      await restore(connection, manifest, files, passphrase, false)
      if (mode === 'apply') {
        transferPhase = 'source-before-apply'
        const beforeApply = await fetchManifest(url, token)
        if (JSON.stringify(beforeApply) !== JSON.stringify(manifest)) {
          throw new Error('source changed before apply')
        }
        transferPhase = 'target-apply'
        await restore(connection, manifest, files, passphrase, true)
      }
    } finally {
      connection.release()
    }
    const totalRows = manifest.tables.reduce((sum, table) => sum + table.rows, 0)
    process.stdout.write(`${mode} verified ${manifest.tables.length} tables and ${totalRows} rows\n`)
  } finally {
    await pool.end()
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  const databaseCode = typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && /^[A-Z0-9]{5}$/iu.test(error.code)
    ? error.code : 'unknown'
  const safeMessage = error instanceof Error && SAFE_TRANSFER_MESSAGE.test(error.message)
    ? `; reason=${error.message}` : ''
  process.stderr.write(`Cloud.ru SQL snapshot transfer failed at ${transferPhase}; databaseCode=${databaseCode}${safeMessage}; target transaction rolled back if active.\n`)
  process.exitCode = 1
})
