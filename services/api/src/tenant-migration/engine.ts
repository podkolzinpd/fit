import type { QueryResultRow } from 'pg'

import type { DatabaseClient } from '../db/types.js'
import {
  buildMigrationTable,
  checksumRows,
  fingerprintFullCohort,
  fingerprintStandaloneClient,
  fingerprintTenant,
  getTenantMigrationRoot,
  readJsonObject,
  TenantMigrationArtifactError,
} from './bundle.js'
import {
  FULL_COHORT_MIGRATION_TABLES,
  FULL_COHORT_SOURCE_PREFLIGHT_SQL,
  SOURCE_PREFLIGHT_SQL,
  STANDALONE_CLIENT_MIGRATION_TABLES,
  STANDALONE_CLIENT_SOURCE_PREFLIGHT_SQL,
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

interface StandaloneClientSourcePreflightRow extends QueryResultRow {
  client_profile_exists: boolean
  owned_client_count: number
  has_non_standalone_root: boolean
  has_membership: boolean
  has_active_relationship: boolean
  has_cross_boundary_merge: boolean
  has_pending_push: boolean
  has_chat_media: boolean
}

interface FullCohortSourcePreflightRow extends QueryResultRow {
  cohort_exists: boolean
}

interface FullCohortTargetPreflightRow extends QueryResultRow {
  has_native_identity: boolean
  has_missing_anchor: boolean
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
  const manifest = getMigrationManifest(bundle)
  if (bundle.tables.length !== manifest.length) {
    throw new TenantMigrationError('manifest_mismatch')
  }
  manifest.forEach((spec, index) => {
    if (bundle.tables[index]?.name !== spec.name) {
      throw new TenantMigrationError('manifest_mismatch')
    }
  })
}

function getMigrationManifest(
  bundle: TenantMigrationBundle,
): readonly TenantMigrationTableSpec[] {
  if (bundle.format === 'fit-tenant-bundle-v1') {
    return TENANT_MIGRATION_TABLES
  }
  if (bundle.format === 'fit-standalone-client-bundle-v1') {
    return STANDALONE_CLIENT_MIGRATION_TABLES
  }
  return FULL_COHORT_MIGRATION_TABLES
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

async function inspectStandaloneClientSource(
  client: DatabaseClient,
  clientProfileId: string,
): Promise<void> {
  const result = requireSingleRow(
    await client.query<StandaloneClientSourcePreflightRow>(
      STANDALONE_CLIENT_SOURCE_PREFLIGHT_SQL,
      [clientProfileId],
    ),
  )
  if (!result.client_profile_exists) {
    throw new TenantMigrationError('standalone_client_not_found')
  }
  if (result.owned_client_count > 1) {
    throw new TenantMigrationError('standalone_client_contract_mismatch')
  }
  if (result.has_non_standalone_root) {
    throw new TenantMigrationError('standalone_client_partition_not_owned')
  }
  if (result.has_membership || result.has_active_relationship) {
    throw new TenantMigrationError('standalone_client_has_active_trainer')
  }
  if (result.has_cross_boundary_merge) {
    throw new TenantMigrationError('tenant_merge_crosses_boundary')
  }
  if (result.has_pending_push) {
    throw new TenantMigrationError('tenant_has_pending_push')
  }
  if (result.has_chat_media) {
    throw new TenantMigrationError('standalone_client_has_chat_media')
  }
}

async function inspectFullCohortSource(client: DatabaseClient): Promise<void> {
  const result = requireSingleRow(
    await client.query<FullCohortSourcePreflightRow>(
      FULL_COHORT_SOURCE_PREFLIGHT_SQL,
      ['application-v1'],
    ),
  )
  if (!result.cohort_exists) {
    throw new TenantMigrationError('full_cohort_empty')
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

async function configureMigrationTransaction(
  client: DatabaseClient,
): Promise<void> {
  await client.query(`set local statement_timeout = '5min'`)
  // jsonb renders timestamptz values in the current session timezone. Source
  // and target clusters may use different defaults, so normalize both sides
  // before calculating or validating deterministic row checksums.
  await client.query(`set local timezone = 'UTC'`)
}

export async function exportTenant(
  source: DatabaseClient,
  trainerId: string,
  now: Date = new Date(),
): Promise<TenantMigrationBundle> {
  await source.query('begin isolation level repeatable read read only')
  try {
    await configureMigrationTransaction(source)
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

export async function exportStandaloneClient(
  source: DatabaseClient,
  clientProfileId: string,
  now: Date = new Date(),
): Promise<TenantMigrationBundle> {
  await source.query('begin isolation level repeatable read read only')
  try {
    await configureMigrationTransaction(source)
    await inspectStandaloneClientSource(source, clientProfileId)
    const tables: TenantMigrationTable[] = []
    for (const spec of STANDALONE_CLIENT_MIGRATION_TABLES) {
      tables.push(await readTable(source, spec, clientProfileId, true))
    }
    await source.query('commit')
    return {
      format: 'fit-standalone-client-bundle-v1',
      createdAt: now.toISOString(),
      tenantFingerprint: fingerprintStandaloneClient(clientProfileId),
      clientProfileId,
      tables,
    }
  } catch (error) {
    await rollbackQuietly(source)
    throw error
  }
}

export async function exportFullCohort(
  source: DatabaseClient,
  now: Date = new Date(),
): Promise<TenantMigrationBundle> {
  await source.query('begin isolation level repeatable read read only')
  try {
    await configureMigrationTransaction(source)
    await inspectFullCohortSource(source)
    const tables: TenantMigrationTable[] = []
    for (const spec of FULL_COHORT_MIGRATION_TABLES) {
      tables.push(await readTable(source, spec, 'application-v1', true))
    }
    await source.query('commit')
    return {
      format: 'fit-full-cohort-bundle-v1',
      createdAt: now.toISOString(),
      tenantFingerprint: fingerprintFullCohort(tables),
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
  const root = getTenantMigrationRoot(bundle)
  const reports: TenantMigrationTableReport[] = []
  for (const spec of getMigrationManifest(bundle)) {
    const expected = getBundleTable(bundle, spec.name)
    let actual: TenantMigrationTable
    try {
      actual = bundle.format === 'fit-full-cohort-bundle-v1'
        ? await readFullCohortTargetTable(target, spec, expected)
        : await readTable(target, spec, root.profileId, false)
    } catch (error) {
      if (
        error instanceof TenantMigrationError
        && error.code === 'database_contract_mismatch'
      ) {
        throw new TenantMigrationError(`target_validation_failed:${spec.name}`)
      }
      throw error
    }
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

function migrationRowKey(
  row: JsonObject,
  keyColumns: readonly string[],
): string {
  const key = keyColumns.map((column) => {
    if (!(column in row)) {
      throw new TenantMigrationError('database_contract_mismatch')
    }
    return row[column]
  })
  return JSON.stringify(key)
}

async function readFullCohortTargetTable(
  target: DatabaseClient,
  spec: TenantMigrationTableSpec,
  expected: TenantMigrationTable,
): Promise<TenantMigrationTable> {
  const keyColumns = spec.keyColumns ?? ['id']
  let rows: readonly JsonDatabaseRow[]
  try {
    rows = await target.query<JsonDatabaseRow>(
      `select to_jsonb(existing) as row
       from ${spec.targetRecord} existing`,
    )
  } catch {
    throw new TenantMigrationError(`target_read_failed:${spec.name}`)
  }

  const expectedByKey = new Map(
    expected.rows.map((row) => [migrationRowKey(row, keyColumns), row]),
  )
  const expectedColumns = Object.keys(expected.rows[0] ?? {})
  const projectedRows = readJsonRows(rows).map((row) => {
    const expectedRow = expectedByKey.get(migrationRowKey(row, keyColumns))
    const columns = expectedRow === undefined
      ? expectedColumns
      : Object.keys(expectedRow)
    const projected: JsonObject = {}
    for (const column of columns) {
      if (!(column in row)) {
        throw new TenantMigrationError('database_contract_mismatch')
      }
      projected[column] = row[column]!
    }
    return projected
  })
  return buildMigrationTable(spec.name, projectedRows)
}

async function inspectFullCohortTarget(
  target: DatabaseClient,
  bundle: TenantMigrationBundle,
): Promise<void> {
  const profiles = getBundleTable(bundle, 'public.profiles')
  const result = requireSingleRow(
    await target.query<FullCohortTargetPreflightRow>(
      `with expected_profiles as (
         select expected.id
         from jsonb_populate_recordset(
           null::public.profiles,
           $1::jsonb
         ) expected
       ), anchored_profiles as (
         select identity.profile_id
         from app_private.auth_identities identity
         union
         select assignment.profile_id
         from app_private.profile_rollout_assignments assignment
         union
         select session.profile_id
         from app_private.yandex_app_sessions session
         union
         select session.profile_id
         from app_private.yandex_pilot_sessions session
       )
       select
         exists (
           select 1
           from app_private.auth_identities identity
           where identity.identity_origin = 'native'
         ) as has_native_identity,
         exists (
           select 1
           from anchored_profiles anchor
           where not exists (
             select 1
             from expected_profiles expected
             where expected.id = anchor.profile_id
           )
         ) as has_missing_anchor`,
      [JSON.stringify(profiles.rows)],
    ),
  )
  if (result.has_native_identity) {
    throw new TenantMigrationError('full_cohort_target_has_native_identity')
  }
  if (result.has_missing_anchor) {
    throw new TenantMigrationError('full_cohort_target_anchor_missing_from_snapshot')
  }
}

async function clearFullCohortTarget(
  target: DatabaseClient,
  bundle: TenantMigrationBundle,
  manifest: readonly TenantMigrationTableSpec[],
): Promise<void> {
  const lockedTables = [
    ...manifest.map((spec) => spec.targetRecord),
    'app_private.auth_identities',
    'app_private.profile_rollout_assignments',
    'app_private.yandex_app_sessions',
    'app_private.yandex_pilot_sessions',
  ]
  await target.query(
    `lock table ${lockedTables.join(', ')} in access exclusive mode`,
  )
  await inspectFullCohortTarget(target, bundle)

  await target.query(
    `create temporary table preserved_auth_identities
       on commit drop as table app_private.auth_identities`,
  )
  await target.query(
    `create temporary table preserved_profile_rollout_assignments
       on commit drop as table app_private.profile_rollout_assignments`,
  )
  await target.query(
    `create temporary table preserved_yandex_app_sessions
       on commit drop as table app_private.yandex_app_sessions`,
  )
  await target.query(
    `create temporary table preserved_yandex_pilot_sessions
       on commit drop as table app_private.yandex_pilot_sessions`,
  )
  await target.query('delete from app_private.yandex_app_sessions')
  await target.query('delete from app_private.yandex_pilot_sessions')
  await target.query('delete from app_private.profile_rollout_assignments')
  await target.query('delete from app_private.auth_identities')

  for (const spec of [...manifest].reverse()) {
    try {
      await target.query(`delete from ${spec.targetRecord}`)
    } catch {
      throw new TenantMigrationError(`target_replace_failed:${spec.name}`)
    }
  }
}

async function restoreFullCohortTargetAnchors(
  target: DatabaseClient,
): Promise<void> {
  await target.query(
    `insert into app_private.auth_identities
     select * from preserved_auth_identities`,
  )
  await target.query(
    `insert into app_private.profile_rollout_assignments
     select * from preserved_profile_rollout_assignments`,
  )
  await target.query(
    `insert into app_private.yandex_app_sessions
     select * from preserved_yandex_app_sessions`,
  )
  await target.query(
    `insert into app_private.yandex_pilot_sessions
     select * from preserved_yandex_pilot_sessions`,
  )
}

async function beginTargetTransaction(target: DatabaseClient): Promise<void> {
  await target.query('begin isolation level serializable')
  await configureMigrationTransaction(target)
}

async function lockTenant(
  target: DatabaseClient,
  rootKind: string,
  rootProfileId: string,
): Promise<void> {
  await target.query(
    `select pg_advisory_xact_lock(
       hashtextextended('fit-tenant:migration', 0)
     )`,
  )
  await target.query(
    `select pg_advisory_xact_lock(
       hashtextextended('fit-tenant:' || $1 || ':' || $2, 0)
     )`,
    [rootKind, rootProfileId],
  )
}

export async function importTenant(
  target: DatabaseClient,
  bundle: TenantMigrationBundle,
  apply: boolean,
): Promise<TenantMigrationReport> {
  requireExactManifest(bundle)
  const root = getTenantMigrationRoot(bundle)
  const manifest = getMigrationManifest(bundle)
  await beginTargetTransaction(target)
  try {
    await lockTenant(target, root.kind, root.profileId)
    const insertedRows = new Map<string, number>()
    const replacesFullCohort = bundle.format === 'fit-full-cohort-bundle-v1'
    if (replacesFullCohort) {
      await clearFullCohortTarget(target, bundle, manifest)
    }
    for (const spec of manifest) {
      const table = getBundleTable(bundle, spec.name)
      if (table.rows.length === 0) {
        insertedRows.set(spec.name, 0)
        continue
      }
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
           ${replacesFullCohort ? '' : `where not exists (
             select 1
             from ${spec.targetRecord} existing
             where ${keyPredicate}
           )`}
           returning true as inserted`,
          [JSON.stringify(table.rows)],
        )
      } catch {
        throw new TenantMigrationError(`target_import_failed:${spec.name}`)
      }
      insertedRows.set(spec.name, inserted.length)
    }
    if (replacesFullCohort) {
      await restoreFullCohortTargetAnchors(target)
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
    await configureMigrationTransaction(target)
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
