import type { BrotliTenantMigrationEnvelope } from './types.js'

// Yandex Serverless Containers accepts at most 3.5 MB for the complete HTTP
// request. Keep explicit room for headers while allowing the encrypted cohort
// to remain one request and one target transaction.
export const STAGE_TENANT_ARTIFACT_LIMIT_BYTES = 3_400_000

export const STAGE_TENANT_BINARY_CONTENT_TYPE = 'application/octet-stream'

const FORMAT_HEADER = 'x-fit-tenant-migration-envelope-format'
const SALT_HEADER = 'x-fit-tenant-migration-salt'
const IV_HEADER = 'x-fit-tenant-migration-iv'
const AUTH_TAG_HEADER = 'x-fit-tenant-migration-auth-tag'

type HeaderValue = string | string[] | undefined
type Headers = Readonly<Record<string, HeaderValue>>

export interface StageTenantMigrationTransport {
  body: Buffer
  headers: Readonly<Record<string, string>>
}

function readHeader(
  headers: Headers,
  name: string,
): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function isCanonicalBase64(value: string, decodedBytes: number): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  const decoded = Buffer.from(value, 'base64')
  return decoded.byteLength === decodedBytes
    && decoded.toString('base64') === value
}

export function encodeStageTenantMigrationTransport(
  envelope: BrotliTenantMigrationEnvelope,
): StageTenantMigrationTransport {
  return {
    body: Buffer.from(envelope.ciphertext, 'base64'),
    headers: {
      [AUTH_TAG_HEADER]: envelope.cipher.authTag,
      [FORMAT_HEADER]: envelope.format,
      [IV_HEADER]: envelope.cipher.iv,
      [SALT_HEADER]: envelope.kdf.salt,
    },
  }
}

export function decodeStageTenantMigrationTransport(
  body: unknown,
  headers: Headers,
): BrotliTenantMigrationEnvelope | undefined {
  if (!Buffer.isBuffer(body) || body.byteLength === 0) return undefined
  const format = readHeader(headers, FORMAT_HEADER)
  const salt = readHeader(headers, SALT_HEADER)
  const iv = readHeader(headers, IV_HEADER)
  const authTag = readHeader(headers, AUTH_TAG_HEADER)
  if (
    format !== 'fit-tenant-envelope-v3'
    || salt === undefined
    || iv === undefined
    || authTag === undefined
    || !isCanonicalBase64(salt, 16)
    || !isCanonicalBase64(iv, 12)
    || !isCanonicalBase64(authTag, 16)
  ) return undefined

  return {
    format,
    compression: { name: 'brotli' },
    kdf: { name: 'scrypt', salt },
    cipher: {
      name: 'aes-256-gcm',
      iv,
      authTag,
    },
    ciphertext: body.toString('base64'),
  }
}
