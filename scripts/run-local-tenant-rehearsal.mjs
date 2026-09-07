import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const ROOT_DIRECTORY = join(import.meta.dirname, '..')
const SOURCE_CONTAINER = 'supabase_db_fit'
const TARGET_CONTAINER = 'fit-yandex-postgres-local'
const SOURCE_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const TARGET_DATABASE_PORT = '55432'
const TARGET_DATABASE_PREFIX = 'fit_tenant_rehearsal_'
const DATABASE_NAME_PATTERN = /^fit_tenant_rehearsal_[1-9][0-9]*_[12]$/u
const SYNTHETIC_TRAINER_ID = '90000000-0000-4000-8000-000000000009'
const EXPECTED_TABLE_COUNT = 28
const FIXTURE_PATH = join(
  ROOT_DIRECTORY,
  'services/api/src/tenant-migration/rehearsal-source-fixture.sql',
)
const CLI_PATH = join(
  ROOT_DIRECTORY,
  'services/api/dist/tenant-migration/cli.js',
)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export const PRODUCTION_LIKE_TABLES = Object.freeze([
  'public.profiles',
  'public.trainers',
  'public.clients',
  'public.client_trainers',
  'public.client_invitations',
  'public.client_trainer_relationships',
  'public.client_merge_operations',
  'public.custom_exercises',
  'public.client_progress',
  'public.client_custom_metrics',
  'public.client_progress_custom',
  'public.client_goals',
  'public.goal_stages',
  'public.goal_criteria',
  'public.workouts',
  'public.workout_exercises',
  'public.workout_sets',
  'public.client_training_summaries',
  'public.client_published_training_summaries',
  'public.assistant_conversations',
  'public.assistant_messages',
  'public.assistant_actions',
  'public.app_feedback',
  'public.push_subscriptions',
  'public.notification_preferences',
  'app_private.workout_create_requests',
])

export const EXPECTED_EMPTY_TABLES = Object.freeze([
  'app_private.push_notifications_outbox',
  'app_private.live_workout_operations',
])

export function assertRehearsalDatabaseName(databaseName) {
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('unsafe_rehearsal_database_name')
  }
  return databaseName
}

export function assertLocalDatabaseUrl(connectionString, expectedPort) {
  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('invalid_local_database_url')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== expectedPort
  ) throw new Error('remote_database_url_rejected')
  return connectionString
}

function readLines(output) {
  return output.split('\n').map((line) => line.trim()).filter(Boolean)
}

function parseTables(lines, pattern) {
  const tables = new Map()
  for (const line of lines) {
    const match = line.match(pattern)
    if (match === null || tables.has(match[1])) {
      throw new Error('migration_output_invalid')
    }
    tables.set(match[1], {
      rows: Number(match[2]),
      inserted: match[3] === undefined ? undefined : Number(match[3]),
    })
  }
  return tables
}

function assertTableCount(headerCount, tables) {
  if (
    headerCount !== EXPECTED_TABLE_COUNT
    || tables.size !== EXPECTED_TABLE_COUNT
  ) throw new Error('migration_manifest_count_invalid')
}

export function parseExportSummary(output) {
  const [header, ...tableLines] = readLines(output)
  const headerMatch = header?.match(
    /^exported: tenant ([0-9a-f]{16}); ([0-9]+) tables$/u,
  )
  if (headerMatch === undefined || headerMatch === null) {
    throw new Error('migration_export_output_invalid')
  }
  const tables = parseTables(
    tableLines,
    /^([a-z_]+\.[a-z_]+): rows=([0-9]+)$/u,
  )
  assertTableCount(Number(headerMatch[2]), tables)
  return { fingerprint: headerMatch[1], tables }
}

export function parseMigrationReport(output, expectedMode) {
  const [header, ...tableLines] = readLines(output)
  const headerMatch = header?.match(
    /^(dry-run|applied|validated): tenant ([0-9a-f]{16}); ([0-9]+) tables$/u,
  )
  if (
    headerMatch === undefined
    || headerMatch === null
    || headerMatch[1] !== expectedMode
  ) throw new Error('migration_report_output_invalid')
  const tables = parseTables(
    tableLines,
    /^([a-z_]+\.[a-z_]+): rows=([0-9]+), inserted=([0-9]+)$/u,
  )
  assertTableCount(Number(headerMatch[3]), tables)
  return { fingerprint: headerMatch[2], tables }
}

export function assertProductionLikeManifest(summary) {
  for (const tableName of PRODUCTION_LIKE_TABLES) {
    if ((summary.tables.get(tableName)?.rows ?? 0) < 1) {
      throw new Error(`production_like_table_empty:${tableName}`)
    }
  }
  for (const tableName of EXPECTED_EMPTY_TABLES) {
    if (summary.tables.get(tableName)?.rows !== 0) {
      throw new Error(`target_only_table_not_empty:${tableName}`)
    }
  }
}

export function assertIdempotentApply(report) {
  for (const [tableName, table] of report.tables) {
    if (table.inserted !== 0) {
      throw new Error(`repeated_apply_inserted_rows:${tableName}`)
    }
  }
}

function run(command, args, options = {}) {
  const capture = options.capture === true
  const result = spawnSync(command, args, {
    cwd: ROOT_DIRECTORY,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error !== undefined || result.status !== 0) {
    const safeDiagnostic = options.safeErrorPattern === undefined
      ? undefined
      : (result.stderr ?? '').match(options.safeErrorPattern)?.[1]
    throw new Error(
      `${options.label ?? 'command'}_failed`
        + (safeDiagnostic === undefined ? '' : `:${safeDiagnostic}`),
    )
  }
  return result.stdout ?? ''
}

function targetDatabaseUrl(databaseName) {
  assertRehearsalDatabaseName(databaseName)
  return assertLocalDatabaseUrl(
    `postgresql://postgres:postgres@127.0.0.1:${TARGET_DATABASE_PORT}/${databaseName}`,
    TARGET_DATABASE_PORT,
  )
}

function prepareSourceFixture() {
  const fixture = readFileSync(FIXTURE_PATH, 'utf8')
  run(
    'podman',
    [
      'exec',
      '--interactive',
      SOURCE_CONTAINER,
      'psql',
      '--username',
      'postgres',
      '--dbname',
      'postgres',
      '--set',
      'ON_ERROR_STOP=1',
    ],
    { capture: true, input: fixture, label: 'source_fixture' },
  )
}

function createTargetDatabase(databaseName) {
  assertRehearsalDatabaseName(databaseName)
  run(
    'podman',
    [
      'exec',
      TARGET_CONTAINER,
      'createdb',
      '--username',
      'postgres',
      '--template',
      'template0',
      databaseName,
    ],
    { capture: true, label: 'target_database_create' },
  )
}

function dropTargetDatabase(databaseName) {
  assertRehearsalDatabaseName(databaseName)
  run(
    'podman',
    [
      'exec',
      TARGET_CONTAINER,
      'dropdb',
      '--username',
      'postgres',
      '--force',
      databaseName,
    ],
    { capture: true, label: 'target_database_cleanup' },
  )
}

function migrateTargetDatabase(databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl, TARGET_DATABASE_PORT)
  run(npmCommand, ['--prefix', 'services/api', 'run', 'db:migrate'], {
    capture: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    label: 'target_migrations',
  })
}

function runMigrationCli(args, databaseUrl, passphrase, label) {
  const environment = {
    ...process.env,
    FIT_TENANT_SOURCE_DATABASE_URL: assertLocalDatabaseUrl(
      SOURCE_DATABASE_URL,
      '54322',
    ),
    FIT_TENANT_TARGET_DATABASE_URL: assertLocalDatabaseUrl(
      databaseUrl,
      TARGET_DATABASE_PORT,
    ),
    FIT_TENANT_MIGRATION_PASSPHRASE: passphrase,
  }
  delete environment.FIT_TENANT_REMOTE_CONFIRMATION
  delete environment.FIT_TENANT_REMOTE_APPLY_CONFIRMATION
  return run(process.execPath, [CLI_PATH, ...args], {
    capture: true,
    env: environment,
    label,
    safeErrorPattern: /Tenant migration failed: ([a-z0-9_.:-]+)/u,
  })
}

function assertDryRunRolledBack(databaseName) {
  assertRehearsalDatabaseName(databaseName)
  const count = run(
    'podman',
    [
      'exec',
      TARGET_CONTAINER,
      'psql',
      '--username',
      'postgres',
      '--dbname',
      databaseName,
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      `select count(*) from public.profiles where id = '${SYNTHETIC_TRAINER_ID}'::uuid`,
    ],
    { capture: true, label: 'dry_run_rollback_check' },
  ).trim()
  if (count !== '0') throw new Error('dry_run_changed_target')
}

function assertEncryptedArtifact(artifactPath) {
  const artifact = lstatSync(artifactPath)
  if (!artifact.isFile() || artifact.isSymbolicLink()) {
    throw new Error('migration_artifact_not_regular_file')
  }
  if ((artifact.mode & 0o777) !== 0o600) {
    throw new Error('migration_artifact_permissions_invalid')
  }
  if (readFileSync(artifactPath, 'utf8').includes(SYNTHETIC_TRAINER_ID)) {
    throw new Error('migration_artifact_contains_plaintext_tenant_id')
  }
}

function cleanupArtifact(directory, artifactPath) {
  try {
    const artifact = lstatSync(artifactPath)
    if (!artifact.isFile() || artifact.isSymbolicLink()) {
      throw new Error('unsafe_artifact_cleanup_target')
    }
    unlinkSync(artifactPath)
  } catch (error) {
    if (
      typeof error !== 'object'
      || error === null
      || !('code' in error)
      || error.code !== 'ENOENT'
    ) throw error
  }
  const temporaryDirectory = lstatSync(directory)
  if (!temporaryDirectory.isDirectory() || temporaryDirectory.isSymbolicLink()) {
    throw new Error('unsafe_artifact_directory_cleanup_target')
  }
  rmdirSync(directory)
}

async function rehearse(runNumber) {
  const databaseName = assertRehearsalDatabaseName(
    `${TARGET_DATABASE_PREFIX}${process.pid}_${runNumber}`,
  )
  const databaseUrl = targetDatabaseUrl(databaseName)
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), `fit-tenant-rehearsal-${runNumber}-`),
  )
  const artifactPath = join(temporaryDirectory, 'tenant.fit')
  const passphrase = randomBytes(32).toString('base64url')
  let databaseCreated = false
  try {
    console.log(`[tenant-rehearsal] ${runNumber}/2: создаю чистую локальную БД.`)
    createTargetDatabase(databaseName)
    databaseCreated = true
    migrateTargetDatabase(databaseUrl)

    const exported = parseExportSummary(
      runMigrationCli(
        ['export', '--trainer-id', SYNTHETIC_TRAINER_ID, '--out', artifactPath],
        databaseUrl,
        passphrase,
        'tenant_export',
      ),
    )
    assertProductionLikeManifest(exported)
    assertEncryptedArtifact(artifactPath)

    const dryRun = parseMigrationReport(
      runMigrationCli(
        ['import', '--in', artifactPath],
        databaseUrl,
        passphrase,
        'tenant_dry_run',
      ),
      'dry-run',
    )
    if (dryRun.fingerprint !== exported.fingerprint) {
      throw new Error('dry_run_tenant_fingerprint_mismatch')
    }
    assertDryRunRolledBack(databaseName)

    const applied = parseMigrationReport(
      runMigrationCli(
        ['import', '--in', artifactPath, '--apply'],
        databaseUrl,
        passphrase,
        'tenant_apply',
      ),
      'applied',
    )
    const repeated = parseMigrationReport(
      runMigrationCli(
        ['import', '--in', artifactPath, '--apply'],
        databaseUrl,
        passphrase,
        'tenant_repeated_apply',
      ),
      'applied',
    )
    assertIdempotentApply(repeated)
    const validated = parseMigrationReport(
      runMigrationCli(
        ['validate', '--in', artifactPath],
        databaseUrl,
        passphrase,
        'tenant_validate',
      ),
      'validated',
    )
    if (
      applied.fingerprint !== exported.fingerprint
      || repeated.fingerprint !== exported.fingerprint
      || validated.fingerprint !== exported.fingerprint
    ) throw new Error('tenant_fingerprint_mismatch')

    const rowCount = [...exported.tables.values()].reduce(
      (total, table) => total + table.rows,
      0,
    )
    console.log(
      `[tenant-rehearsal] ${runNumber}/2 пройдена: tenant ${exported.fingerprint}; `
        + `${exported.tables.size} таблиц; ${rowCount} строк.`,
    )
  } finally {
    if (databaseCreated) dropTargetDatabase(databaseName)
    cleanupArtifact(temporaryDirectory, artifactPath)
  }
}

async function main() {
  console.log('[tenant-rehearsal] Подготавливаю только локальный Podman stack.')
  run(npmCommand, ['run', 'local:prepare'], { label: 'local_prepare' })
  prepareSourceFixture()
  run(npmCommand, ['--prefix', 'services/api', 'run', 'build'], {
    label: 'api_build',
  })
  await rehearse(1)
  await rehearse(2)
  console.log(
    '[tenant-rehearsal] Две локальные репетиции завершены; временные БД и артефакты удалены.',
  )
}

const executedPath = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(resolve(process.argv[1])).href

if (executedPath === import.meta.url) {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[tenant-rehearsal] Ошибка: ${message}`)
    console.error('[tenant-rehearsal] Облачные базы и production не затрагивались.')
    process.exitCode = 1
  }
}
