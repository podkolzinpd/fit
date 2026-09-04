import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

import type { PoolConfig } from 'pg'

import { PgDatabasePool } from '../db/pg-pool.js'
import { encryptMigrationBundle } from './bundle.js'
import { exportTenant, TenantMigrationError } from './engine.js'
import type {
  TenantMigrationBundle,
  TenantMigrationEnvelope,
  TenantMigrationTableReport,
} from './types.js'

type Environment = Readonly<Record<string, string | undefined>>
export type RemoteTenantRehearsalMode = 'audit' | 'dry-run' | 'apply'

interface RemoteTenantRehearsalSettings {
  mode: RemoteTenantRehearsalMode
  sourceConfig: PoolConfig
  stageContainerUrl?: string
  trainerId: string
  yandexIamToken?: string
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

export class RemoteTenantRehearsalError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'RemoteTenantRehearsalError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  return {
    connectionString: poolerUrl.href,
    ssl: {
      ca: readCertificate(certificatePath),
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
  const trainerId = requireEnvironment(environment, 'FIT_TENANT_TRAINER_ID')
  if (!UUID_PATTERN.test(trainerId)) {
    throw new RemoteTenantRehearsalError('trainer_id_invalid')
  }
  const sourceConfig = buildSupabaseSourceConfig(environment, readCertificate)
  if (mode === 'audit') return { mode, sourceConfig, trainerId }

  const yandexIamToken = requireEnvironment(environment, 'YC_TOKEN')
  if (yandexIamToken.length > 8_192) {
    throw new RemoteTenantRehearsalError('yandex_token_invalid')
  }
  return {
    mode,
    sourceConfig,
    stageContainerUrl: readStageContainerUrl(environment),
    trainerId,
    yandexIamToken,
  }
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
    throw new RemoteTenantRehearsalError(
      `stage_request_failed:${response.status}`,
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
  try {
    sourceConnection = await sourcePool.connect()
    bundle = await exportTenant(sourceConnection, settings.trainerId)
  } catch (error) {
    if (
      error instanceof RemoteTenantRehearsalError
      || error instanceof TenantMigrationError
    ) throw error
    throw new RemoteTenantRehearsalError('source_database_failed')
  } finally {
    sourceConnection?.release()
    await sourcePool.end()
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
