import { createHash } from 'node:crypto'

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import type { YandexMediaStorageConfig } from './object-storage-media.js'

const OBJECT_STORAGE_ENDPOINT = 'https://storage.yandexcloud.net'
const OBJECT_STORAGE_REGION = 'ru-central1'
const VITAL_PREFIX = 'fit-exercise-media/vital-pro/'
const SAFE_PATH = /^[a-z0-9][a-z0-9-]*(?:-end)?\.(?:jpg|mp4)$/
const SHA256 = /^[a-f0-9]{64}$/
const EXPECTED_FILES = 2_010
const EXPECTED_BYTES = 71_514_430
const MAX_OBJECT_BYTES = 1_048_576
const VERIFY_CONCURRENCY = 8

export const VITAL_MEDIA_BINARY_CONTENT_TYPE = 'application/vnd.fit.vital-media'
export const VITAL_MEDIA_APPLY_CONFIRMATION = 'APPLY_VITAL_MEDIA_TO_YANDEX_STAGE'

type VitalMediaVersioningCheck = 'not_probed_read_only' | 'pending_manifest_write'
type VitalMediaUploadResult = {
  outcome: 'skipped' | 'uploaded'
  versioning: 'verified'
}

export interface VitalMediaManifestFile {
  bytes: number
  path: string
  sha256: string
}

export interface VitalMediaAuditReport {
  bytes: number
  enumeration: 'manifest_only'
  fingerprint: string
  mismatched: number
  missing: number
  objects: number
  verified: number
}

export interface VitalMediaDeploymentService {
  audit(files: readonly VitalMediaManifestFile[]): Promise<VitalMediaAuditReport>
  preflight(allowWrite: boolean): Promise<{
    bucket: string
    private: true
    versioning: VitalMediaVersioningCheck
  }>
  upload(file: VitalMediaManifestFile, body: Uint8Array): Promise<VitalMediaUploadResult>
}

export class VitalMediaDeploymentError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'VitalMediaDeploymentError'
  }
}

function contentType(path: string): 'image/jpeg' | 'video/mp4' {
  return path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
}

function key(path: string): string {
  if (!SAFE_PATH.test(path)) throw new VitalMediaDeploymentError('vital_media_path_invalid')
  return `${VITAL_PREFIX}${path}`
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined
  const metadata = error.$metadata
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) return undefined
  return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined
}

function missing(error: unknown): boolean {
  return statusCode(error) === 404
    || (typeof error === 'object' && error !== null && 'name' in error
      && (error.name === 'NoSuchKey' || error.name === 'NotFound'))
}

function versioned(versionId: string | undefined): versionId is string {
  return typeof versionId === 'string' && versionId !== '' && versionId !== 'null'
}

function fingerprint(files: readonly VitalMediaManifestFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(String(file.bytes))
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\n')
  }
  return hash.digest('hex').slice(0, 16)
}

export function validateVitalMediaManifestFiles(
  files: readonly VitalMediaManifestFile[],
): { bytes: number; fingerprint: string } {
  if (files.length !== EXPECTED_FILES) {
    throw new VitalMediaDeploymentError('vital_media_manifest_count_invalid')
  }
  const paths = new Set<string>()
  let bytes = 0
  for (const file of files) {
    if (
      !SAFE_PATH.test(file.path)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 1
      || file.bytes > MAX_OBJECT_BYTES
      || !SHA256.test(file.sha256)
      || paths.has(file.path)
    ) throw new VitalMediaDeploymentError('vital_media_manifest_entry_invalid')
    paths.add(file.path)
    bytes += file.bytes
  }
  if (bytes !== EXPECTED_BYTES) {
    throw new VitalMediaDeploymentError('vital_media_manifest_bytes_invalid')
  }
  return { bytes, fingerprint: fingerprint(files) }
}

async function mapConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const value = values[cursor]
      cursor += 1
      if (value !== undefined) await operation(value)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

export class YandexVitalMediaDeployment implements VitalMediaDeploymentService {
  private readonly client: S3Client

  constructor(private readonly config: YandexMediaStorageConfig) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: OBJECT_STORAGE_ENDPOINT,
      maxAttempts: 5,
      region: OBJECT_STORAGE_REGION,
    })
  }

  async preflight(allowWrite: boolean): Promise<{
    bucket: string
    private: true
    versioning: VitalMediaVersioningCheck
  }> {
    const anonymousList = await fetch(
      `${OBJECT_STORAGE_ENDPOINT}/${this.config.bucket}?list-type=2&max-keys=1&prefix=${encodeURIComponent(VITAL_PREFIX)}`,
      { redirect: 'manual' },
    ).catch(() => undefined)
    if (anonymousList?.status !== 403) {
      throw new VitalMediaDeploymentError('vital_media_bucket_not_private')
    }

    return {
      bucket: this.config.bucket,
      private: true,
      versioning: allowWrite ? 'pending_manifest_write' : 'not_probed_read_only',
    }
  }

  async upload(
    file: VitalMediaManifestFile,
    body: Uint8Array,
  ): Promise<VitalMediaUploadResult> {
    if (
      !SAFE_PATH.test(file.path)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes > MAX_OBJECT_BYTES
      || file.bytes !== body.byteLength
      || !SHA256.test(file.sha256)
      || createHash('sha256').update(body).digest('hex') !== file.sha256
    ) throw new VitalMediaDeploymentError('vital_media_upload_invalid')

    const objectKey = key(file.path)
    const expectedType = contentType(file.path)
    const existing = await this.readObject(file).catch((error: unknown) => {
      if (
        error instanceof VitalMediaDeploymentError
        && error.code === 'vital_media_object_missing'
      ) return undefined
      throw error
    })
    if (existing?.matches && versioned(existing.versionId)) {
      return { outcome: 'skipped', versioning: 'verified' }
    }

    const put = await this.client.send(new PutObjectCommand({
      Body: body,
      Bucket: this.config.bucket,
      CacheControl: 'private, max-age=3600',
      ContentLength: body.byteLength,
      ContentType: expectedType,
      Key: objectKey,
      Metadata: { 'source-sha256': file.sha256 },
    })).catch(() => {
      throw new VitalMediaDeploymentError('vital_media_upload_failed')
    })
    if (!versioned(put.VersionId)) {
      throw new VitalMediaDeploymentError('vital_media_object_version_missing')
    }

    const stored = await this.readObject(file).catch(() => undefined)
    if (
      stored === undefined
      || !stored.matches
      || stored.versionId !== put.VersionId
    ) {
      throw new VitalMediaDeploymentError('vital_media_upload_verification_failed')
    }
    return { outcome: 'uploaded', versioning: 'verified' }
  }

  async audit(files: readonly VitalMediaManifestFile[]): Promise<VitalMediaAuditReport> {
    const contract = validateVitalMediaManifestFiles(files)
    let missingCount = 0
    let mismatched = 0
    let verified = 0
    await mapConcurrent(files, VERIFY_CONCURRENCY, async (file) => {
      const result = await this.readObject(file).catch((error: unknown) => {
        if (
          error instanceof VitalMediaDeploymentError
          && error.code === 'vital_media_object_missing'
        ) return undefined
        throw error
      })
      if (result === undefined) {
        missingCount += 1
      } else if (result.matches) verified += 1
      else mismatched += 1
    })

    return {
      bytes: contract.bytes,
      enumeration: 'manifest_only',
      fingerprint: contract.fingerprint,
      mismatched,
      missing: missingCount,
      objects: files.length,
      verified,
    }
  }

  private async readObject(
    file: VitalMediaManifestFile,
  ): Promise<{ matches: boolean; versionId: string | undefined }> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key(file.path),
      }))
      const body = await response.Body?.transformToByteArray()
      if (body === undefined) return { matches: false, versionId: response.VersionId }
      return {
        matches: body.byteLength === file.bytes
          && createHash('sha256').update(body).digest('hex') === file.sha256
          && response.ContentType === contentType(file.path),
        versionId: response.VersionId,
      }
    } catch (error) {
      if (missing(error)) throw new VitalMediaDeploymentError('vital_media_object_missing')
      throw new VitalMediaDeploymentError('vital_media_object_read_failed')
    }
  }

}
