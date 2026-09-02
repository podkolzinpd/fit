import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from 'node:crypto'

import type {
  JsonObject,
  JsonValue,
  TenantMigrationBundle,
  TenantMigrationEnvelope,
  TenantMigrationTable,
} from './types.js'

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KEY_BYTES = 32
const SCRYPT_COST = 32_768

export class TenantMigrationArtifactError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TenantMigrationArtifactError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new TenantMigrationArtifactError('artifact_invalid')
  }
  return value
}

export function readJsonObject(value: unknown): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new TenantMigrationArtifactError('artifact_invalid')
  }
  return value
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  return `{${entries.map(([key, nested]) =>
    `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`
}

export function checksumRows(rows: readonly JsonObject[]): string {
  const canonicalRows = rows.map(canonicalJson).sort()
  return createHash('sha256').update(canonicalRows.join('\n')).digest('hex')
}

export function fingerprintTenant(trainerId: string): string {
  return createHash('sha256')
    .update(`fit-tenant-v1:${trainerId}`)
    .digest('hex')
    .slice(0, 16)
}

export function buildMigrationTable(
  name: string,
  rows: readonly JsonObject[],
): TenantMigrationTable {
  const stableRows = [...rows].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  )
  return {
    name,
    rowCount: stableRows.length,
    checksum: checksumRows(stableRows),
    rows: stableRows,
  }
}

function readMigrationTable(value: unknown): TenantMigrationTable {
  if (!isRecord(value)) throw new TenantMigrationArtifactError('artifact_invalid')
  const name = readString(value, 'name')
  const checksum = readString(value, 'checksum')
  const rowCount = value.rowCount
  const rawRows = value.rows
  if (
    !Number.isSafeInteger(rowCount)
    || typeof rowCount !== 'number'
    || rowCount < 0
    || !CHECKSUM_PATTERN.test(checksum)
    || !Array.isArray(rawRows)
  ) throw new TenantMigrationArtifactError('artifact_invalid')
  const rows = rawRows.map(readJsonObject)
  if (rowCount !== rows.length || checksumRows(rows) !== checksum) {
    throw new TenantMigrationArtifactError('artifact_checksum_mismatch')
  }
  return { name, rowCount, checksum, rows }
}

export function readMigrationBundle(value: unknown): TenantMigrationBundle {
  if (!isRecord(value) || value.format !== 'fit-tenant-bundle-v1') {
    throw new TenantMigrationArtifactError('artifact_invalid')
  }
  const createdAt = readString(value, 'createdAt')
  const tenantFingerprint = readString(value, 'tenantFingerprint')
  const trainerId = readString(value, 'trainerId')
  if (
    Number.isNaN(Date.parse(createdAt))
    || !/^[0-9a-f]{16}$/.test(tenantFingerprint)
    || !UUID_PATTERN.test(trainerId)
    || fingerprintTenant(trainerId) !== tenantFingerprint
    || !Array.isArray(value.tables)
  ) throw new TenantMigrationArtifactError('artifact_invalid')
  const tables = value.tables.map(readMigrationTable)
  if (new Set(tables.map((table) => table.name)).size !== tables.length) {
    throw new TenantMigrationArtifactError('artifact_invalid')
  }
  return {
    format: 'fit-tenant-bundle-v1',
    createdAt,
    tenantFingerprint,
    trainerId,
    tables,
  }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      KEY_BYTES,
      { N: SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error !== null) reject(error)
        else resolve(key)
      },
    )
  })
}

export async function encryptMigrationBundle(
  bundle: TenantMigrationBundle,
  passphrase: string,
): Promise<TenantMigrationEnvelope> {
  if (passphrase.length < 20) {
    throw new TenantMigrationArtifactError('passphrase_too_short')
  }
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(canonicalJson(readJsonObject(bundle))),
    cipher.final(),
  ])
  return {
    format: 'fit-tenant-envelope-v1',
    kdf: { name: 'scrypt', salt: salt.toString('base64') },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  }
}

export async function decryptMigrationBundle(
  value: unknown,
  passphrase: string,
): Promise<TenantMigrationBundle> {
  if (
    !isRecord(value)
    || value.format !== 'fit-tenant-envelope-v1'
    || !isRecord(value.kdf)
    || value.kdf.name !== 'scrypt'
    || !isRecord(value.cipher)
    || value.cipher.name !== 'aes-256-gcm'
  ) throw new TenantMigrationArtifactError('artifact_invalid')
  try {
    const salt = Buffer.from(readString(value.kdf, 'salt'), 'base64')
    const iv = Buffer.from(readString(value.cipher, 'iv'), 'base64')
    const authTag = Buffer.from(readString(value.cipher, 'authTag'), 'base64')
    const ciphertext = Buffer.from(readString(value, 'ciphertext'), 'base64')
    if (salt.length !== 16 || iv.length !== 12 || authTag.length !== 16) {
      throw new TenantMigrationArtifactError('artifact_invalid')
    }
    const key = await deriveKey(passphrase, salt)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
    return readMigrationBundle(JSON.parse(plaintext))
  } catch (error) {
    if (error instanceof TenantMigrationArtifactError) throw error
    throw new TenantMigrationArtifactError('artifact_decryption_failed')
  }
}
