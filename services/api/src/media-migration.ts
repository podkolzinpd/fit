import { createHash } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import {
  mediaObjectKey,
  type MediaNamespace,
  type MediaObjectStorage,
} from './object-storage-media.js'

const LIST_PAGE_SIZE = 100
const MAX_OBJECTS = 10_000
const MAX_OBJECT_BYTES = 512 * 1024 * 1024

function createLegacyStorageClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

type LegacyStorageClient = ReturnType<typeof createLegacyStorageClient>

export type MediaMigrationMode = 'audit' | 'apply'

export interface LegacyMediaObject {
  contentType: string
  namespace: MediaNamespace
  path: string
}

export interface LegacyMediaSource {
  list(): Promise<readonly LegacyMediaObject[]>
  read(object: LegacyMediaObject): Promise<Uint8Array>
}

export interface MediaMigrationReport {
  bytes: number
  copied: number
  fingerprint: string
  objects: number
  verified: number
}

export class MediaMigrationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'MediaMigrationError'
  }
}

interface SourceObjectRecord {
  contentType: string
  namespace: MediaNamespace
  path: string
  sha256: string
  sizeBytes: number
}

function objectContentType(
  namespace: MediaNamespace,
  path: string,
): string {
  if (namespace === 'chat-media') return 'image/jpeg'
  if (path.endsWith('.jpg')) return 'image/jpeg'
  if (path.endsWith('.mp4')) return 'video/mp4'
  throw new MediaMigrationError('source_media_type_unsupported')
}

async function listSupabaseFolder(
  client: LegacyStorageClient,
  namespace: MediaNamespace,
  folder: string,
  output: LegacyMediaObject[],
  depth: number,
): Promise<void> {
  if (depth > 8) throw new MediaMigrationError('source_media_tree_too_deep')
  const storage = client.storage.from(namespace)
  let offset = 0
  while (true) {
    const { data, error } = await storage.list(folder, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new MediaMigrationError('source_media_list_failed')
    for (const item of data) {
      const path = folder === '' ? item.name : `${folder}/${item.name}`
      if (item.id === null) {
        await listSupabaseFolder(client, namespace, path, output, depth + 1)
      } else {
        mediaObjectKey(namespace, path)
        output.push({
          contentType: objectContentType(namespace, path),
          namespace,
          path,
        })
        if (output.length > MAX_OBJECTS) {
          throw new MediaMigrationError('source_media_limit_exceeded')
        }
      }
    }
    if (data.length < LIST_PAGE_SIZE) break
    offset += data.length
  }
}

export class SupabaseLegacyMediaSource implements LegacyMediaSource {
  private readonly client: LegacyStorageClient

  constructor(url: string, serviceRoleKey: string) {
    this.client = createLegacyStorageClient(url, serviceRoleKey)
  }

  async list(): Promise<readonly LegacyMediaObject[]> {
    const output: LegacyMediaObject[] = []
    await listSupabaseFolder(this.client, 'chat-media', '', output, 0)
    await listSupabaseFolder(
      this.client,
      'fit-exercise-media',
      '',
      output,
      0,
    )
    return output.sort((left, right) =>
      `${left.namespace}/${left.path}`.localeCompare(
        `${right.namespace}/${right.path}`,
      ),
    )
  }

  async read(object: LegacyMediaObject): Promise<Uint8Array> {
    const { data, error } = await this.client.storage
      .from(object.namespace)
      .download(object.path)
    if (error) throw new MediaMigrationError('source_media_read_failed')
    if (data.size < 1 || data.size > MAX_OBJECT_BYTES) {
      throw new MediaMigrationError('source_media_size_invalid')
    }
    return new Uint8Array(await data.arrayBuffer())
  }
}

function mediaFingerprint(records: readonly SourceObjectRecord[]): string {
  const hash = createHash('sha256')
  for (const record of records) {
    hash.update(record.namespace)
    hash.update('\0')
    hash.update(record.path)
    hash.update('\0')
    hash.update(String(record.sizeBytes))
    hash.update('\0')
    hash.update(record.sha256)
    hash.update('\n')
  }
  return hash.digest('hex').slice(0, 16)
}

export async function migrateMedia(
  source: LegacyMediaSource,
  target: MediaObjectStorage,
  mode: MediaMigrationMode,
): Promise<MediaMigrationReport> {
  const objects = await source.list()
  const records: SourceObjectRecord[] = []
  let bytes = 0
  let copied = 0
  let verified = 0
  for (const object of objects) {
    let sourceBytes: Uint8Array
    try {
      sourceBytes = await source.read(object)
    } catch (error) {
      if (error instanceof MediaMigrationError) throw error
      throw new MediaMigrationError('source_media_read_failed')
    }
    const sha256 = createHash('sha256').update(sourceBytes).digest('hex')
    const sourceRecord = {
      ...object,
      sha256,
      sizeBytes: sourceBytes.byteLength,
    }
    records.push(sourceRecord)
    bytes += sourceBytes.byteLength

    let stored
    try {
      stored = await target.stat(object.namespace, object.path)
    } catch {
      throw new MediaMigrationError('target_media_stat_failed')
    }
    const matches = stored?.sizeBytes === sourceBytes.byteLength
      && stored.sha256 === sha256
    if (!matches && mode === 'apply') {
      try {
        await target.write(
          object.namespace,
          object.path,
          sourceBytes,
          object.contentType,
          true,
        )
      } catch {
        throw new MediaMigrationError('target_media_write_failed')
      }
      copied += 1
      try {
        stored = await target.stat(object.namespace, object.path)
      } catch {
        throw new MediaMigrationError('target_media_validation_failed')
      }
    }
    if (
      stored?.sizeBytes === sourceBytes.byteLength
      && stored.sha256 === sha256
    ) verified += 1
    else if (mode === 'apply') {
      throw new MediaMigrationError('target_media_validation_failed')
    }
  }
  return {
    bytes,
    copied,
    fingerprint: mediaFingerprint(records),
    objects: records.length,
    verified,
  }
}

export function readMediaMigrationMode(
  value: string | undefined,
): MediaMigrationMode {
  if (value !== 'audit' && value !== 'apply') {
    throw new MediaMigrationError('media_migration_mode_invalid')
  }
  return value
}
