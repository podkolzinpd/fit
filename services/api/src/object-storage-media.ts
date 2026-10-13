import { createHash } from 'node:crypto'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { ChatImageUpload, ChatMediaStore } from './chat-media.js'
import type { VitalMediaSigner } from './vital-media.js'

const YANDEX_OBJECT_STORAGE_ENDPOINT = 'https://storage.yandexcloud.net'
const YANDEX_OBJECT_STORAGE_REGION = 'ru-central1'
const CLOUDRU_OBJECT_STORAGE_ENDPOINT = 'https://s3.cloud.ru'
const CLOUDRU_OBJECT_STORAGE_REGION = 'ru-central-1'
const OBJECT_STORAGE_DELETE_TIMEOUT_MS = 5_000
const CHAT_MEDIA_PREFIX = 'chat-media'
const VITAL_MEDIA_PREFIX = 'fit-exercise-media'
const TRAINER_PROFILE_MEDIA_PREFIX = 'trainer-profile-media'
const SAFE_OBJECT_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/

export const VITAL_MEDIA_CACHE_CONTROL = 'private, max-age=3000, immutable'

export interface YandexMediaStorageConfig {
  accessKeyId: string
  bucket: string
  secretAccessKey: string
  provider?: 'yandex'
}

export interface CloudruMediaStorageConfig {
  accessKeyId: string
  bucket: string
  secretAccessKey: string
  provider: 'cloudru'
}

export type S3MediaStorageConfig = YandexMediaStorageConfig | CloudruMediaStorageConfig

export interface StoredMediaMetadata {
  sha256?: string
  sizeBytes: number
}

export interface MediaObjectStorage {
  read(namespace: MediaNamespace, path: string): Promise<Uint8Array | undefined>
  remove(namespace: MediaNamespace, path: string): Promise<void>
  sign(namespace: MediaNamespace, path: string): Promise<string>
  stat(namespace: MediaNamespace, path: string): Promise<StoredMediaMetadata | undefined>
  write(
    namespace: MediaNamespace,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    overwrite: boolean,
  ): Promise<void>
}

export type MediaNamespace = 'chat-media' | 'fit-exercise-media' | 'trainer-profile-media'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function statusCode(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.$metadata)) return undefined
  const value = error.$metadata.httpStatusCode
  return typeof value === 'number' ? value : undefined
}

function isMissingObject(error: unknown): boolean {
  return statusCode(error) === 404
    || (isRecord(error) && (error.name === 'NotFound' || error.name === 'NoSuchKey'))
}

function isExistingObject(error: unknown): boolean {
  return statusCode(error) === 412
    || (isRecord(error) && error.name === 'PreconditionFailed')
}

function namespacePrefix(namespace: MediaNamespace): string {
  if (namespace === 'chat-media') return CHAT_MEDIA_PREFIX
  if (namespace === 'trainer-profile-media') return TRAINER_PROFILE_MEDIA_PREFIX
  return VITAL_MEDIA_PREFIX
}

export function mediaObjectKey(namespace: MediaNamespace, path: string): string {
  if (
    !SAFE_OBJECT_PATH.test(path)
    || path.startsWith('/')
    || path.endsWith('/')
    || path.includes('//')
    || path.split('/').some((part) => part === '.' || part === '..')
  ) throw new Error('media_object_path_invalid')
  return `${namespacePrefix(namespace)}/${path}`
}

export function readYandexMediaStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): YandexMediaStorageConfig | undefined {
  const bucket = environment.YANDEX_MEDIA_BUCKET?.trim()
  const accessKeyId = environment.YANDEX_MEDIA_ACCESS_KEY_ID?.trim()
  const secretAccessKey = environment.YANDEX_MEDIA_SECRET_ACCESS_KEY?.trim()
  const present = [bucket, accessKeyId, secretAccessKey].filter(Boolean).length
  if (present === 0) return undefined
  if (present !== 3) throw new Error('Yandex media storage configuration is incomplete')
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket ?? '')
    || !/^YC[A-Za-z0-9_-]{20,}$/.test(accessKeyId ?? '')
    || !/^YC[A-Za-z0-9_-]{20,}$/.test(secretAccessKey ?? '')
  ) throw new Error('Yandex media storage configuration is invalid')
  return {
    accessKeyId: accessKeyId ?? '',
    bucket: bucket ?? '',
    secretAccessKey: secretAccessKey ?? '',
  }
}

export function readMediaStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): S3MediaStorageConfig | undefined {
  const provider = environment.FIT_MEDIA_STORAGE_PROVIDER?.trim() || 'yandex'
  if (provider === 'yandex') return readYandexMediaStorageConfig(environment)
  if (provider !== 'cloudru') throw new Error('FIT_MEDIA_STORAGE_PROVIDER is invalid')
  const bucket = environment.CLOUDRU_MEDIA_BUCKET?.trim()
  const tenantId = environment.CLOUDRU_TENANT_ID?.trim()
  const keyId = environment.CLOUDRU_MEDIA_KEY_ID?.trim()
  const secretAccessKey = environment.CLOUDRU_MEDIA_KEY_SECRET?.trim()
  if (!bucket || !tenantId || !keyId || !secretAccessKey) {
    throw new Error('Cloud.ru media storage configuration is incomplete')
  }
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(tenantId)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(keyId)
    || !/^[^\s]{16,256}$/.test(secretAccessKey)
  ) throw new Error('Cloud.ru media storage configuration is invalid')
  return {
    accessKeyId: `${tenantId}:${keyId}`,
    bucket,
    provider: 'cloudru',
    secretAccessKey,
  }
}

export class YandexMediaObjectStorage implements MediaObjectStorage {
  private readonly client: S3Client

  constructor(
    private readonly config: S3MediaStorageConfig,
    private readonly deleteTimeoutMs = OBJECT_STORAGE_DELETE_TIMEOUT_MS,
  ) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.provider === 'cloudru'
        ? CLOUDRU_OBJECT_STORAGE_ENDPOINT
        : YANDEX_OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: config.provider === 'cloudru',
      region: config.provider === 'cloudru'
        ? CLOUDRU_OBJECT_STORAGE_REGION
        : YANDEX_OBJECT_STORAGE_REGION,
    })
  }

  async read(namespace: MediaNamespace, path: string): Promise<Uint8Array | undefined> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: mediaObjectKey(namespace, path),
      }))
      return await response.Body?.transformToByteArray()
    } catch (error) {
      if (isMissingObject(error)) return undefined
      throw new Error('media_object_read_failed', { cause: error })
    }
  }

  async stat(namespace: MediaNamespace, path: string): Promise<StoredMediaMetadata | undefined> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: mediaObjectKey(namespace, path),
      }))
      if (response.ContentLength === undefined) throw new Error('media_object_stat_failed')
      return {
        sizeBytes: response.ContentLength,
        ...(response.Metadata?.['source-sha256'] === undefined
          ? {}
          : { sha256: response.Metadata['source-sha256'] }),
      }
    } catch (error) {
      if (isMissingObject(error)) return undefined
      if (error instanceof Error && error.message === 'media_object_stat_failed') throw error
      throw new Error('media_object_stat_failed', { cause: error })
    }
  }

  async write(
    namespace: MediaNamespace,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    overwrite: boolean,
  ): Promise<void> {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    try {
      await this.client.send(new PutObjectCommand({
        Body: bytes,
        Bucket: this.config.bucket,
        ...(namespace === 'fit-exercise-media'
          ? { CacheControl: VITAL_MEDIA_CACHE_CONTROL }
          : {}),
        ContentLength: bytes.byteLength,
        ContentType: contentType,
        ...(overwrite ? {} : { IfNoneMatch: '*' }),
        Key: mediaObjectKey(namespace, path),
        Metadata: { 'source-sha256': sha256 },
      }))
    } catch (error) {
      if (!overwrite && isExistingObject(error)) {
        const existing = await this.stat(namespace, path)
        if (existing?.sizeBytes === bytes.byteLength && existing.sha256 === sha256) return
      }
      throw new Error('media_object_write_failed', { cause: error })
    }
  }

  async sign(namespace: MediaNamespace, path: string): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: mediaObjectKey(namespace, path),
        }),
        { expiresIn: 60 * 60 },
      )
    } catch {
      throw new Error('media_object_signing_failed')
    }
  }

  async remove(namespace: MediaNamespace, path: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: mediaObjectKey(namespace, path),
      }), { abortSignal: AbortSignal.timeout(this.deleteTimeoutMs) })
    } catch {
      throw new Error('media_object_delete_failed')
    }
  }
}

export class YandexChatMediaStore implements ChatMediaStore {
  constructor(private readonly storage: MediaObjectStorage) {}

  upload(path: string, image: ChatImageUpload): Promise<void> {
    return this.storage.write('chat-media', path, image.bytes, image.mimeType, false)
  }

  sign(path: string): Promise<string> {
    return this.storage.sign('chat-media', path)
  }

  remove(path: string): Promise<void> {
    return this.storage.remove('chat-media', path)
  }
}

export class YandexVitalMediaSigner implements VitalMediaSigner {
  constructor(private readonly storage: MediaObjectStorage) {}

  sign(path: string): Promise<string> {
    return this.storage.sign('fit-exercise-media', path)
  }
}
