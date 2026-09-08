import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

import type { PoolConfig, QueryResultRow } from 'pg'

import { PgDatabasePool } from '../db/pg-pool.js'
import type { DatabaseClient } from '../db/types.js'
import { encryptMigrationBundle } from './bundle.js'
import { exportTenant, TenantMigrationError } from './engine.js'
import type {
  TenantMigrationBundle,
  TenantMigrationEnvelope,
  TenantMigrationTableReport,
} from './types.js'

type Environment = Readonly<Record<string, string | undefined>>
export type RemoteTenantRehearsalMode = 'audit' | 'dry-run' | 'apply'
export type RemoteTenantSelection =
  | { kind: 'configured'; trainerId: string }
  | { kind: 'smallest-eligible' }

type CandidateAcceptance = (
  bundle: TenantMigrationBundle,
) => Promise<boolean>

interface RemoteTenantRehearsalSettings {
  mode: RemoteTenantRehearsalMode
  sourceConfig: PoolConfig
  stageContainerUrl?: string
  tenantSelection: RemoteTenantSelection
  yandexIamToken?: string
}

interface CandidateTrainerRow extends QueryResultRow {
  trainer_id: string
}

interface StageTenantMigrationResponse {
  status: 'tenant_migration_dry_run' | 'tenant_migration_applied'
  tables: TenantMigrationTableReport[]
  tenantFingerprint: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPABASE_PROJECT_PATTERN = /^[a-z]{20}$/
const SUPABASE_POOLER_HOST_PATTERN =
  /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/
const STAGE_CONTAINER_HOST_PATTERN =
  /^[a-z0-9]+\.containers\.yandexcloud\.net$/
const STAGE_APPLY_CONFIRMATION = 'APPLY_TENANT_TO_YANDEX_STAGE'
const STAGE_ARTIFACT_LIMIT_BYTES = 3 * 1024 * 1024
const RESPONSE_LIMIT_BYTES = 1024 * 1024
const AUTO_CANDIDATE_LIMIT = 1_000
const AUTO_STAGE_CONFLICT_LIMIT = 10
const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/
const STAGE_REJECTION_CODE_PATTERN = /^[a-z0-9_.:-]{1,96}$/
const SOURCE_TRANSPORT_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])
const SKIPPABLE_CANDIDATE_ERROR_CODES = new Set([
  'tenant_empty',
  'tenant_has_foreign_actor',
  'tenant_has_pending_push',
  'tenant_merge_crosses_boundary',
  'trainer_not_found',
  'tenant_shared',
])
const AUTO_CANDIDATES_SQL = `
select trainer.profile_id::text as trainer_id
from public.trainers trainer
join public.clients client on client.trainer_id = trainer.profile_id
group by trainer.profile_id
order by count(*) asc, trainer.profile_id asc
limit ${AUTO_CANDIDATE_LIMIT}`

export class RemoteTenantRehearsalError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'RemoteTenantRehearsalError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readSourceDatabaseFailureCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') {
    return 'source_database_failed'
  }
  if (POSTGRES_SQLSTATE_PATTERN.test(error.code)) {
    return `source_database_failed:sqlstate_${error.code}`
  }
  if (SOURCE_TRANSPORT_ERROR_CODES.has(error.code)) {
    return `source_database_failed:transport_${error.code}`
  }
  return 'source_database_failed'
}

function requireEnvironment(
  environment: Environment,
  name: string,
): string {
  const value = environment[name]
  if (value === undefined || value.length === 0) {
    throw new RemoteTenantRehearsalError('configuration_missing')
  }
  return value
}

function readMode(environment: Environment): RemoteTenantRehearsalMode {
  const mode = environment.FIT_TENANT_REHEARSAL_MODE
  if (mode !== 'audit' && mode !== 'dry-run' && mode !== 'apply') {
    throw new RemoteTenantRehearsalError('mode_invalid')
  }
  if (
    mode === 'apply'
    && environment.FIT_TENANT_REMOTE_APPLY_CONFIRMATION
      !== STAGE_APPLY_CONFIRMATION
  ) throw new RemoteTenantRehearsalError('apply_not_confirmed')
  return mode
}

export function buildSupabaseSourceConfig(
  environment: Environment,
  readCertificate: (path: string) => string = (path) =>
    readFileSync(path, 'utf8'),
): PoolConfig {
  const projectId = requireEnvironment(environment, 'SUPABASE_PROJECT_ID')
  const password = requireEnvironment(environment, 'SUPABASE_DB_PASSWORD')
  const certificatePath = requireEnvironment(
    environment,
    'FIT_TENANT_SOURCE_SSL_ROOT_CERT',
  )
  if (!SUPABASE_PROJECT_PATTERN.test(projectId)) {
    throw new RemoteTenantRehearsalError('source_project_invalid')
  }

  let poolerUrl: URL
  try {
    poolerUrl = new URL(
      requireEnvironment(environment, 'FIT_TENANT_SOURCE_POOLER_URL'),
    )
  } catch {
    throw new RemoteTenantRehearsalError('source_url_invalid')
  }
  if (
    poolerUrl.protocol !== 'postgresql:'
    || !SUPABASE_POOLER_HOST_PATTERN.test(poolerUrl.hostname)
    || poolerUrl.port !== '5432'
    || poolerUrl.pathname !== '/postgres'
    || poolerUrl.username !== `postgres.${projectId}`
    || poolerUrl.password !== ''
    || poolerUrl.search !== ''
    || poolerUrl.hash !== ''
  ) throw new RemoteTenantRehearsalError('source_url_invalid')

  poolerUrl.password = password
  let ca: string
  try {
    ca = readCertificate(certificatePath)
  } catch {
    throw new RemoteTenantRehearsalError('source_certificate_unreadable')
  }
  return {
    connectionString: poolerUrl.href,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
  }
}

function readStageContainerUrl(environment: Environment): string {
  const value = requireEnvironment(environment, 'FIT_TENANT_STAGE_CONTAINER_URL')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new RemoteTenantRehearsalError('stage_url_invalid')
  }
  if (
    parsed.protocol !== 'https:'
    || !STAGE_CONTAINER_HOST_PATTERN.test(parsed.hostname)
    || parsed.port !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || (parsed.pathname !== '' && parsed.pathname !== '/')
    || parsed.search !== ''
    || parsed.hash !== ''
  ) throw new RemoteTenantRehearsalError('stage_url_invalid')
  return parsed.origin
}

export function readRemoteTenantRehearsalSettings(
  environment: Environment,
  readCertificate?: (path: string) => string,
): RemoteTenantRehearsalSettings {
  const mode = readMode(environment)
  const selectionMode = environment.FIT_TENANT_SELECTION_MODE ?? 'configured'
  let tenantSelection: RemoteTenantSelection
  if (selectionMode === 'smallest-eligible') {
    if (mode === 'apply') {
      throw new RemoteTenantRehearsalError('automatic_apply_forbidden')
    }
    tenantSelection = { kind: 'smallest-eligible' }
  } else if (selectionMode === 'configured') {
    const trainerId = requireEnvironment(environment, 'FIT_TENANT_TRAINER_ID')
    if (!UUID_PATTERN.test(trainerId)) {
      throw new RemoteTenantRehearsalError('trainer_id_invalid')
    }
    tenantSelection = { kind: 'configured', trainerId }
  } else {
    throw new RemoteTenantRehearsalError('selection_mode_invalid')
  }
  const sourceConfig = buildSupabaseSourceConfig(environment, readCertificate)
  if (mode === 'audit') return { mode, sourceConfig, tenantSelection }

  const yandexIamToken = requireEnvironment(environment, 'YC_TOKEN')
  if (yandexIamToken.length > 8_192) {
    throw new RemoteTenantRehearsalError('yandex_token_invalid')
  }
  return {
    mode,
    sourceConfig,
    stageContainerUrl: readStageContainerUrl(environment),
    tenantSelection,
    yandexIamToken,
  }
}

export async function exportSelectedTenant(
  source: DatabaseClient,
  selection: RemoteTenantSelection,
  now: Date = new Date(),
  acceptCandidate?: CandidateAcceptance,
): Promise<TenantMigrationBundle> {
  if (selection.kind === 'configured') {
    return exportTenant(source, selection.trainerId, now)
  }

  let candidates: readonly CandidateTrainerRow[]
  try {
    candidates = await source.query<CandidateTrainerRow>(AUTO_CANDIDATES_SQL)
  } catch {
    throw new RemoteTenantRehearsalError('candidate_discovery_failed')
  }

  let stageRejectedCandidate = false
  for (const candidate of candidates) {
    if (!UUID_PATTERN.test(candidate.trainer_id)) {
      throw new RemoteTenantRehearsalError('candidate_contract_mismatch')
    }
    try {
      const bundle = await exportTenant(source, candidate.trainer_id, now)
      if (acceptCandidate !== undefined && !await acceptCandidate(bundle)) {
        stageRejectedCandidate = true
        continue
      }
      return bundle
    } catch (error) {
      if (
        error instanceof TenantMigrationError
        && SKIPPABLE_CANDIDATE_ERROR_CODES.has(error.code)
      ) continue
      throw error
    }
  }
  if (stageRejectedCandidate) {
    throw new RemoteTenantRehearsalError('stage_candidate_not_found')
  }
  throw new RemoteTenantRehearsalError('candidate_not_found')
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: 'rows' | 'inserted',
): number {
  const value = record[key]
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw new RemoteTenantRehearsalError('stage_response_invalid')
  }
  return value
}

export function readStageTenantMigrationResponse(
  value: unknown,
  expectedStatus: StageTenantMigrationResponse['status'],
  bundle: TenantMigrationBundle,
  requireZeroInserted = false,
): StageTenantMigrationResponse {
  if (
    !isRecord(value)
    || Object.keys(value).sort().join(',')
      !== 'status,tables,tenantFingerprint'
    || value.status !== expectedStatus
    || value.tenantFingerprint !== bundle.tenantFingerprint
    || !Array.isArray(value.tables)
    || value.tables.length !== bundle.tables.length
  ) throw new RemoteTenantRehearsalError('stage_response_invalid')

  const tables = value.tables.map((candidate, index) => {
    const expected = bundle.tables[index]
    if (
      expected === undefined
      || !isRecord(candidate)
      || Object.keys(candidate).sort().join(',') !== 'inserted,name,rows'
      || candidate.name !== expected.name
    ) throw new RemoteTenantRehearsalError('stage_response_invalid')
    const rows = readNonNegativeInteger(candidate, 'rows')
    const inserted = readNonNegativeInteger(candidate, 'inserted')
    if (
      rows !== expected.rowCount
      || (requireZeroInserted && inserted !== 0)
    ) throw new RemoteTenantRehearsalError('stage_response_mismatch')
    return { name: expected.name, rows, inserted }
  })

  return {
    status: expectedStatus,
    tenantFingerprint: bundle.tenantFingerprint,
    tables,
  }
}

export function readStageTenantMigrationRejectionCode(
  responseBody: string,
): string | undefined {
  if (Buffer.byteLength(responseBody) > RESPONSE_LIMIT_BYTES) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody)
  } catch {
    return undefined
  }
  if (
    !isRecord(parsed)
    || Object.keys(parsed).sort().join(',') !== 'code,status'
    || parsed.status !== 'tenant_migration_rejected'
    || typeof parsed.code !== 'string'
    || !STAGE_REJECTION_CODE_PATTERN.test(parsed.code)
  ) return undefined
  return parsed.code
}

async function requestStage(
  settings: RemoteTenantRehearsalSettings,
  bundle: TenantMigrationBundle,
  envelope: TenantMigrationEnvelope,
  passphrase: string,
  apply: boolean,
  requireZeroInserted = false,
): Promise<StageTenantMigrationResponse> {
  if (
    settings.stageContainerUrl === undefined
    || settings.yandexIamToken === undefined
  ) throw new RemoteTenantRehearsalError('stage_configuration_missing')

  let response: Response
  try {
    response = await fetch(
      `${settings.stageContainerUrl}/stage/tenant-migration/${apply ? 'apply' : 'dry-run'}`,
      {
        body: JSON.stringify(envelope),
        headers: {
          authorization: `Bearer ${settings.yandexIamToken}`,
          'content-type': 'application/json',
          'x-fit-tenant-migration-passphrase': passphrase,
          ...(apply
            ? {
                'x-fit-tenant-migration-confirmation':
                  STAGE_APPLY_CONFIRMATION,
              }
            : {}),
        },
        method: 'POST',
        signal: AbortSignal.timeout(290_000),
      },
    )
  } catch {
    throw new RemoteTenantRehearsalError('stage_request_failed:network')
  }
  const responseBody = await response.text()
  if (!response.ok) {
    const rejectionCode = response.status === 409
      ? readStageTenantMigrationRejectionCode(responseBody)
      : undefined
    throw new RemoteTenantRehearsalError(
      `stage_request_failed:${response.status}${
        rejectionCode === undefined ? '' : `:${rejectionCode}`
      }`,
    )
  }
  if (Buffer.byteLength(responseBody) > RESPONSE_LIMIT_BYTES) {
    throw new RemoteTenantRehearsalError('stage_response_invalid')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody)
  } catch {
    throw new RemoteTenantRehearsalError('stage_response_invalid')
  }
  return readStageTenantMigrationResponse(
    parsed,
    apply ? 'tenant_migration_applied' : 'tenant_migration_dry_run',
    bundle,
    requireZeroInserted,
  )
}

export function isStageTenantConflict(error: unknown): boolean {
  return error instanceof RemoteTenantRehearsalError
    && error.code.startsWith(
      'stage_request_failed:409:target_validation_failed:',
    )
}

function printBundleSummary(
  bundle: TenantMigrationBundle,
  encryptedBytes: number,
): void {
  const rows = bundle.tables.reduce((total, table) => total + table.rowCount, 0)
  process.stdout.write(
    `audit: tenant ${bundle.tenantFingerprint}; ${bundle.tables.length} tables; ${rows} rows; encrypted_bytes=${encryptedBytes}\n`,
  )
  for (const table of bundle.tables) {
    process.stdout.write(`${table.name}: rows=${table.rowCount}\n`)
  }
}

function printStageSummary(response: StageTenantMigrationResponse): void {
  const inserted = response.tables.reduce(
    (total, table) => total + table.inserted,
    0,
  )
  process.stdout.write(
    `${response.status}: tenant ${response.tenantFingerprint}; inserted=${inserted}\n`,
  )
}

export async function runRemoteTenantRehearsal(
  settings: RemoteTenantRehearsalSettings,
): Promise<void> {
  const sourcePool = new PgDatabasePool(settings.sourceConfig)
  let sourceConnection: Awaited<ReturnType<PgDatabasePool['connect']>> | undefined
  let bundle: TenantMigrationBundle
  let automaticDryRun: Readonly<{
    encryptedBytes: number
    response: StageTenantMigrationResponse
  }> | undefined
  let skippedStageConflicts = 0
  try {
    sourceConnection = await sourcePool.connect()
    bundle = await exportSelectedTenant(
      sourceConnection,
      settings.tenantSelection,
      new Date(),
      settings.mode === 'dry-run'
        && settings.tenantSelection.kind === 'smallest-eligible'
        ? async (candidate) => {
            const passphrase = randomBytes(48).toString('base64url')
            const envelope = await encryptMigrationBundle(candidate, passphrase)
            const encryptedBytes = Buffer.byteLength(JSON.stringify(envelope))
            if (encryptedBytes > STAGE_ARTIFACT_LIMIT_BYTES) {
              throw new RemoteTenantRehearsalError(
                'artifact_too_large_for_stage',
              )
            }
            try {
              const response = await requestStage(
                settings,
                candidate,
                envelope,
                passphrase,
                false,
              )
              automaticDryRun = { encryptedBytes, response }
              return true
            } catch (error) {
              if (!isStageTenantConflict(error)) throw error
              skippedStageConflicts += 1
              if (skippedStageConflicts >= AUTO_STAGE_CONFLICT_LIMIT) {
                throw new RemoteTenantRehearsalError(
                  'stage_candidate_limit_reached',
                )
              }
              return false
            }
          }
        : undefined,
    )
  } catch (error) {
    if (
      error instanceof RemoteTenantRehearsalError
      || error instanceof TenantMigrationError
    ) throw error
    throw new RemoteTenantRehearsalError(
      readSourceDatabaseFailureCode(error),
    )
  } finally {
    sourceConnection?.release()
    await sourcePool.end()
  }

  if (automaticDryRun !== undefined) {
    printBundleSummary(bundle, automaticDryRun.encryptedBytes)
    if (skippedStageConflicts > 0) {
      process.stdout.write(
        `selection: skipped_stage_conflicts=${skippedStageConflicts}\n`,
      )
    }
    printStageSummary(automaticDryRun.response)
    return
  }

  const passphrase = randomBytes(48).toString('base64url')
  const envelope = await encryptMigrationBundle(bundle, passphrase)
  const encryptedBytes = Buffer.byteLength(JSON.stringify(envelope))
  printBundleSummary(bundle, encryptedBytes)
  if (settings.mode === 'audit') return
  if (encryptedBytes > STAGE_ARTIFACT_LIMIT_BYTES) {
    throw new RemoteTenantRehearsalError('artifact_too_large_for_stage')
  }

  printStageSummary(
    await requestStage(settings, bundle, envelope, passphrase, false),
  )
  if (settings.mode === 'dry-run') return

  printStageSummary(
    await requestStage(settings, bundle, envelope, passphrase, true),
  )
  printStageSummary(
    await requestStage(settings, bundle, envelope, passphrase, true, true),
  )
}
