import { spawn } from 'node:child_process'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Pool } from 'pg'

import type { YandexMediaStorageConfig } from './object-storage-media.js'

const OBJECT_STORAGE_ENDPOINT = 'https://storage.yandexcloud.net'
const OBJECT_STORAGE_REGION = 'ru-central1'
const EXPORT_PREFIX = '.cloudru-database-exports/'
const EXPORT_ID = /^[0-9a-f]{32}$/
const VERSION_ID = /^[A-Za-z0-9._~+=/-]{1,512}$/
const SHA256 = /^[0-9a-f]{64}$/
const MAGIC = Buffer.from('FITDBX1\n', 'ascii')
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_DUMP_BYTES = 256 * 1024 * 1024
const SIGNED_URL_SECONDS = 10 * 60
const CLOUDRU_STAGE_DATABASE_HOST = '10.70.10.67'

type Environment = Readonly<Record<string, string | undefined>>

interface DatabaseTransferConnection {
  database: string
  host: string
  password: string
  port: string
  sslMode: 'verify-full' | 'require'
  sslRootCert?: string
  user: string
}

export interface CloudDatabaseExportResult {
  bytes: number
  exportId: string
  sha256: string
  url: string
  versionId: string
}

export interface CloudDatabaseExportService {
  create(passphrase: string): Promise<CloudDatabaseExportResult>
  preflightSource?(): Promise<void>
  remove(exportId: string, versionId: string): Promise<void>
}

export class CloudDatabaseTransferError extends Error {
  constructor(readonly code: string, readonly diagnostic?: string) {
    super(code)
    this.name = 'CloudDatabaseTransferError'
  }
}

function required(environment: Environment, name: string): string {
  const value = environment[name]
  if (value === undefined || value.length === 0) {
    throw new CloudDatabaseTransferError('database_export_configuration_missing')
  }
  return value
}

export function readDatabaseTransferConnection(
  environment: Environment,
  prefix: 'DATABASE' | 'MIGRATION_DATABASE',
): DatabaseTransferConnection {
  const host = required(environment, `${prefix}_HOST`)
  const sslMode = environment[`${prefix}_SSL_MODE`] ?? 'verify-full'
  if (sslMode !== 'verify-full' && sslMode !== 'require') {
    throw new CloudDatabaseTransferError('database_export_ssl_mode_invalid')
  }
  if (sslMode === 'require' && (
    prefix !== 'MIGRATION_DATABASE' ||
    host !== CLOUDRU_STAGE_DATABASE_HOST ||
    environment[`${prefix}_PORT`] !== '5432' ||
    environment[`${prefix}_NAME`] !== 'fit'
  )) {
    throw new CloudDatabaseTransferError('database_export_ssl_mode_invalid')
  }
  return {
    database: required(environment, `${prefix}_NAME`),
    host,
    password: required(environment, `${prefix}_PASSWORD`),
    port: required(environment, `${prefix}_PORT`),
    sslMode,
    ...(sslMode === 'verify-full'
      ? { sslRootCert: required(environment, `${prefix}_SSL_ROOT_CERT`) }
      : {}),
    user: required(environment, `${prefix}_USER`),
  }
}

async function run(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new Error('database transfer command failed'))
    })
  })
}

export function classifyPgDumpFailure(stderr: string): string {
  if (/permission denied|must be owner|insufficient privilege/i.test(stderr)) {
    return 'database_export_source_permission_denied'
  }
  if (/certificate verify failed|SSL error/i.test(stderr)) {
    return 'database_export_source_tls_failed'
  }
  if (/password authentication failed|no password supplied/i.test(stderr)) {
    return 'database_export_source_auth_failed'
  }
  if (/could not connect|connection refused|connection timed out|network is unreachable/i.test(stderr)) {
    return 'database_export_source_connection_failed'
  }
  if (/unrecognized option|invalid option/i.test(stderr)) {
    return 'database_export_pg_dump_option_invalid'
  }
  return 'database_export_source_dump_failed'
}

export function safePgDumpDiagnostic(stderr: string, password: string | undefined): string | undefined {
  const lines = stderr.split(/\r?\n/u)
    .filter((line) => /^(?:pg_dump: error:|connection to server|FATAL:|ERROR:)/iu.test(line))
    .slice(0, 3)
  if (lines.length === 0) return undefined
  let diagnostic = lines.join(' ').replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 500)
  if (password) diagnostic = diagnostic.replaceAll(password, '[REDACTED]')
  return diagnostic.replace(/\b(password|token|secret)\s*[:=]\s*\S+/giu, '$1=[REDACTED]')
}

async function runPgDump(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', args, {
      env: environment,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length)
    })
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(new CloudDatabaseTransferError(
        error.code === 'ENOENT' ? 'database_export_pg_dump_missing' : 'database_export_source_dump_failed',
      ))
    })
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new CloudDatabaseTransferError(
        classifyPgDumpFailure(stderr),
        safePgDumpDiagnostic(stderr, environment.PGPASSWORD),
      ))
    })
  })
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function assertTargetEmpty(
  database: DatabaseTransferConnection,
): Promise<void> {
  const pool = new Pool({
    database: database.database,
    host: database.host,
    password: database.password,
    port: Number(database.port),
    ssl: database.sslMode === 'require'
      ? { rejectUnauthorized: false }
      : { ca: await readFile(required({ sslRootCert: database.sslRootCert }, 'sslRootCert'), 'utf8'), rejectUnauthorized: true },
    user: database.user,
  })
  try {
    const tables = await pool.query<{ schemaname: string; tablename: string }>(
      `select schemaname, tablename
       from pg_catalog.pg_tables
       where schemaname in ('public', 'app_private')
         and not (schemaname = 'app_private' and tablename = 'fit_migrations')
       order by schemaname, tablename`,
    )
    for (const table of tables.rows) {
      const result = await pool.query<{ populated: boolean }>(
        `select exists (
           select 1
           from ${quoteIdentifier(table.schemaname)}.${quoteIdentifier(table.tablename)}
           limit 1
         ) as populated`,
      )
      if (result.rows[0]?.populated === true) {
        throw new CloudDatabaseTransferError('database_restore_target_not_empty')
      }
    }
  } finally {
    await pool.end()
  }
}

async function key(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(passphrase, salt, 32, (error, derivedKey) => {
      if (error === null) resolve(derivedKey)
      else reject(error)
    })
  })
}

export async function encryptDatabaseDump(
  plaintext: Buffer,
  passphrase: string,
): Promise<Buffer> {
  if (plaintext.byteLength > MAX_DUMP_BYTES) {
    throw new CloudDatabaseTransferError('database_export_too_large')
  }
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', await key(passphrase, salt), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted])
}

export async function decryptDatabaseDump(
  encrypted: Buffer,
  passphrase: string,
): Promise<Buffer> {
  const headerBytes = MAGIC.byteLength + SALT_BYTES + IV_BYTES + TAG_BYTES
  if (
    encrypted.byteLength <= headerBytes
    || !encrypted.subarray(0, MAGIC.byteLength).equals(MAGIC)
    || encrypted.byteLength > MAX_DUMP_BYTES + headerBytes
  ) throw new CloudDatabaseTransferError('database_export_invalid')
  let offset = MAGIC.byteLength
  const salt = encrypted.subarray(offset, offset += SALT_BYTES)
  const iv = encrypted.subarray(offset, offset += IV_BYTES)
  const tag = encrypted.subarray(offset, offset += TAG_BYTES)
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      await key(passphrase, salt),
      iv,
    )
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(encrypted.subarray(offset)),
      decipher.final(),
    ])
  } catch {
    throw new CloudDatabaseTransferError('database_export_decryption_failed')
  }
}

function checksum(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function objectKey(exportId: string): string {
  if (!EXPORT_ID.test(exportId)) {
    throw new CloudDatabaseTransferError('database_export_id_invalid')
  }
  return `${EXPORT_PREFIX}${exportId}.dump.aes`
}

export class YandexCloudDatabaseExport implements CloudDatabaseExportService {
  private readonly client: S3Client

  constructor(
    private readonly database: DatabaseTransferConnection,
    private readonly storage: YandexMediaStorageConfig,
  ) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
      },
      endpoint: OBJECT_STORAGE_ENDPOINT,
      maxAttempts: 5,
      region: OBJECT_STORAGE_REGION,
    })
  }

  private dumpArgs(path: string): string[] {
    return [
      '--format=custom',
      '--compress=9',
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--serializable-deferrable',
      '--lock-wait-timeout=5000',
      '--exclude-table-data=app_private.fit_migrations',
      `--host=${this.database.host}`,
      `--port=${this.database.port}`,
      `--username=${this.database.user}`,
      `--dbname=${this.database.database}`,
      `--file=${path}`,
    ]
  }

  private dumpEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PGPASSWORD: this.database.password,
      PGSSLMODE: this.database.sslMode,
      ...(this.database.sslRootCert === undefined ? {} : { PGSSLROOTCERT: this.database.sslRootCert }),
    }
  }

  async preflightSource(): Promise<void> {
    await runPgDump(this.dumpArgs('/dev/null'), this.dumpEnvironment())
  }

  async create(passphrase: string): Promise<CloudDatabaseExportResult> {
    const exportId = randomBytes(16).toString('hex')
    const dumpPath = join(tmpdir(), `fit-${exportId}.dump`)
    try {
      await runPgDump(this.dumpArgs(dumpPath), this.dumpEnvironment())
      const dumpStat = await stat(dumpPath)
      if (dumpStat.size < 1 || dumpStat.size > MAX_DUMP_BYTES) {
        throw new CloudDatabaseTransferError('database_export_size_invalid')
      }
      const encrypted = await encryptDatabaseDump(
        await readFile(dumpPath),
        passphrase,
      )
      const put = await this.client.send(new PutObjectCommand({
        Body: encrypted,
        Bucket: this.storage.bucket,
        ContentLength: encrypted.byteLength,
        ContentType: 'application/vnd.fit.database-export',
        Key: objectKey(exportId),
        Metadata: { sha256: checksum(encrypted) },
      }))
      if (
        typeof put.VersionId !== 'string'
        || !VERSION_ID.test(put.VersionId)
      ) throw new CloudDatabaseTransferError('database_export_not_versioned')
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.storage.bucket,
          Key: objectKey(exportId),
          VersionId: put.VersionId,
        }),
        { expiresIn: SIGNED_URL_SECONDS },
      )
      return {
        bytes: encrypted.byteLength,
        exportId,
        sha256: checksum(encrypted),
        url,
        versionId: put.VersionId,
      }
    } catch (error) {
      if (error instanceof CloudDatabaseTransferError) throw error
      throw new CloudDatabaseTransferError('database_export_failed')
    } finally {
      await rm(dumpPath, { force: true })
    }
  }

  async remove(exportId: string, versionId: string): Promise<void> {
    if (!VERSION_ID.test(versionId)) {
      throw new CloudDatabaseTransferError('database_export_version_invalid')
    }
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.storage.bucket,
        Key: objectKey(exportId),
        VersionId: versionId,
      }))
    } catch {
      throw new CloudDatabaseTransferError('database_export_cleanup_failed')
    }
  }
}

export async function restoreEncryptedDatabaseDump(
  encryptedPath: string,
  expectedSha256: string,
  passphrase: string,
  database: DatabaseTransferConnection,
): Promise<void> {
  if (!SHA256.test(expectedSha256)) {
    throw new CloudDatabaseTransferError('database_export_checksum_invalid')
  }
  const encrypted = await readFile(encryptedPath)
  if (checksum(encrypted) !== expectedSha256) {
    throw new CloudDatabaseTransferError('database_export_checksum_mismatch')
  }
  const restoreId = randomBytes(16).toString('hex')
  const dumpPath = join(tmpdir(), `fit-restore-${restoreId}.dump`)
  try {
    await assertTargetEmpty(database)
    await writeFile(dumpPath, await decryptDatabaseDump(encrypted, passphrase), {
      mode: 0o600,
      flag: 'wx',
    })
    await run('pg_restore', [
      '--data-only',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
      `--host=${database.host}`,
      `--port=${database.port}`,
      `--username=${database.user}`,
      `--dbname=${database.database}`,
      dumpPath,
    ], {
      ...process.env,
      PGPASSWORD: database.password,
      PGSSLMODE: database.sslMode,
      ...(database.sslRootCert === undefined ? {} : { PGSSLROOTCERT: database.sslRootCert }),
    })
  } catch (error) {
    if (error instanceof CloudDatabaseTransferError) throw error
    throw new CloudDatabaseTransferError('database_restore_failed')
  } finally {
    await rm(dumpPath, { force: true })
  }
}

