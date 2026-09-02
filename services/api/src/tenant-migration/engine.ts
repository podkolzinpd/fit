import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from '../db/types.js'
import {
  buildMigrationTable,
  checksumRows,
  fingerprintTenant,
  readJsonObject,
  TenantMigrationArtifactError,
} from './bundle.js'
import {
  SOURCE_PREFLIGHT_SQL,
  TENANT_MIGRATION_TABLES,
  type TenantMigrationTableSpec,
} from './catalog.js'
import type {
  JsonObject,
  TenantMigrationBundle,
  TenantMigrationReport,
  TenantMigrationTable,
  TenantMigrationTableReport,
} from './types.js'

interface JsonDatabaseRow extends QueryResultRow {
  row: unknown
}

interface InsertedDatabaseRow extends QueryResultRow {
  inserted: boolean
}

interface SourcePreflightRow extends QueryResultRow {
  trainer_exists: boolean
  client_count: number
  has_shared_membership: boolean
  has_missing_root_membership: boolean
  has_foreign_relationship: boolean
  has_cross_boundary_merge: boolean
  has_pending_push: boolean
  has_foreign_actor: boolean
}

export class TenantMigrationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TenantMigrationError'
  }
}

function requireSingleRow<Row extends QueryResultRow>(
  rows: readonly Row[],
): Row {
  const row = rows[0]
  if (row === undefined || rows.length !== 1) {
    throw new TenantMigrationError('database_contract_mismatch')
  }
  return row
}

function readJsonRows(rows: readonly JsonDatabaseRow[]): JsonObject[] {
  try {
    return rows.map((row) => readJsonObject(row.row))
  } catch (error) {
    if (error instanceof TenantMigrationArtifactError) {
      throw new TenantMigrationError('database_contract_mismatch')
    }
    throw error
  }
}

function requireExactManifest(bundle: TenantMigrationBundle): void {
  if (bundle.tables.length !== TENANT_MIGRATION_TABLES.length) {
    throw new TenantMigrationError('manifest_mismatch')
  }
  TENANT_MIGRATION_TABLES.forEach((spec, index) => {
    if (bundle.tables[index]?.name !== spec.name) {
      throw new TenantMigrationError('manifest_mismatch')
    }
  })
}

async function inspectSource(
  client: DatabaseClient,
  trainerId: string,
): Promise<void> {
  const result = requireSingleRow(
    await client.query<SourcePreflightRow>(SOURCE_PREFLIGHT_SQL, [trainerId]),
  )
  if (!result.trainer_exists) throw new TenantMigrationError('trainer_not_found')
  if (result.client_count === 0) throw new TenantMigrationError('tenant_empty')
  if (
    result.has_shared_membership
    || result.has_foreign_relationship
    || result.has_missing_root_membership
  ) {
    throw new TenantMigrationError('tenant_shared')
  }
  if (result.has_cross_boundary_merge) {
    throw new TenantMigrationError('tenant_merge_crosses_boundary')
  }
  if (result.has_pending_push) {
    throw new TenantMigrationError('tenant_has_pending_push')
  }
  if (result.has_foreign_actor) {
    throw new TenantMigrationError('tenant_has_foreign_actor')
  }
}

async function readTable(
  client: DatabaseClient,
  spec: TenantMigrationTableSpec,
  trainerId: string,
  source: boolean,
): Promise<TenantMigrationTable> {
  try {
    const rows = await client.query<JsonDatabaseRow>(
      source ? spec.sourceSql : spec.targetSql,
      [trainerId],
    )
    return buildMigrationTable(spec.name, readJsonRows(rows))
  } catch (error) {
    if (error instanceof TenantMigrationError) throw error
    throw new TenantMigrationError(
      `${source ? 'source_read_failed' : 'target_read_failed'}:${spec.name}`,
    )
  }
}

async function rollbackQuietly(client: DatabaseClient): Promise<void> {
  try {
    await client.query('rollback')
  } catch {
    // The original database error remains the actionable failure.
  }
}

export async function exportTenant(
  source: DatabaseClient,
  trainerId: string,
  now: Date = new Date(),
): Promise<TenantMigrationBundle> {
  await source.query('begin isolation level repeatable read read only')
  try {
    await source.query(`set local statement_timeout = '5min'`)
    await inspectSource(source, trainerId)
    const tables: TenantMigrationTable[] = []
    for (const spec of TENANT_MIGRATION_TABLES) {
      tables.push(await readTable(source, spec, trainerId, true))
    }
    await source.query('commit')
    return {
      format: 'fit-tenant-bundle-v1',
      createdAt: now.toISOString(),
      tenantFingerprint: fingerprintTenant(trainerId),
      trainerId,
      tables,
    }
  } catch (error) {
    await rollbackQuietly(source)
    throw error
  }
}

function getBundleTable(
  bundle: TenantMigrationBundle,
  name: string,
): TenantMigrationTable {
  const table = bundle.tables.find((candidate) => candidate.name === name)
  if (table === undefined) throw new TenantMigrationError('manifest_mismatch')
  return table
}

async function validateTargetInTransaction(
  target: DatabaseClient,
  bundle: TenantMigrationBundle,
  insertedRows: ReadonlyMap<string, number>,
): Promise<TenantMigrationTableReport[]> {
  const reports: TenantMigrationTableReport[] = []
  for (const spec of TENANT_MIGRATION_TABLES) {
    const expected = getBundleTable(bundle, spec.name)
    const actual = await readTable(target, spec, bundle.trainerId, false)
    if (
      actual.rowCount !== expected.rowCount
      || checksumRows(actual.rows) !== expected.checksum
    ) throw new TenantMigrationError(`target_validation_failed:${spec.name}`)
    reports.push({
      name: spec.name,
      rows: actual.rowCount,
      inserted: insertedRows.get(spec.name) ?? 0,
    })
  }
  return reports
}

async function beginTargetTransaction(target: DatabaseClient): Promise<void> {
  await target.query('begin isolation level serializable')
  await target.query(`set local statement_timeout = '5min'`)
}

async function lockTenant(
  target: DatabaseClient,
  trainerId: string,
): Promise<void> {
  await target.query(
    `select pg_advisory_xact_lock(hashtextextended('fit-tenant:' || $1, 0))`,
    [trainerId],
  )
}

export async function importTenant(
  target: DatabaseClient,
  bundle: TenantMigrationBundle,
  apply: boolean,
): Promise<TenantMigrationReport> {
  requireExactManifest(bundle)
  await beginTargetTransaction(target)
  try {
    await lockTenant(target, bundle.trainerId)
    const insertedRows = new Map<string, number>()
    for (const spec of TENANT_MIGRATION_TABLES) {
      const table = getBundleTable(bundle, spec.name)
      const keyColumns = spec.keyColumns ?? ['id']
      const keyPredicate = keyColumns
        .map((column) => `existing.${column} = record.${column}`)
        .join(' and ')
      let inserted: readonly InsertedDatabaseRow[]
      try {
        inserted = await target.query<InsertedDatabaseRow>(
          `insert into ${spec.targetRecord}
           select record.*
           from jsonb_populate_recordset(
             null::${spec.targetRecord},
             $1::jsonb
           ) record
           where not exists (
             select 1
             from ${spec.targetRecord} existing
             where ${keyPredicate}
           )
           returning true as inserted`,
          [JSON.stringify(table.rows)],
        )
      } catch {
        throw new TenantMigrationError(`target_import_failed:${spec.name}`)
      }
      insertedRows.set(spec.name, inserted.length)
    }
    const tables = await validateTargetInTransaction(target, bundle, insertedRows)
    await target.query(apply ? 'commit' : 'rollback')
    return {
      mode: apply ? 'applied' : 'dry-run',
      tenantFingerprint: bundle.tenantFingerprint,
      tables,
    }
  } catch (error) {
    await rollbackQuietly(target)
    throw error
  }
}

export async function validateTenant(
  target: DatabaseClient,
  bundle: TenantMigrationBundle,
): Promise<TenantMigrationReport> {
  requireExactManifest(bundle)
  await target.query('begin isolation level repeatable read read only')
  try {
    await target.query(`set local statement_timeout = '5min'`)
    const tables = await validateTargetInTransaction(target, bundle, new Map())
    await target.query('commit')
    return {
      mode: 'validated',
      tenantFingerprint: bundle.tenantFingerprint,
      tables,
    }
  } catch (error) {
    await rollbackQuietly(target)
    throw error
  }
}
