import type { MediaObjectStorage } from '../object-storage-media.js'
import { TenantMigrationError } from './engine.js'
import type { JsonObject, TenantMigrationBundle } from './types.js'

const CHAT_TABLE = 'public.chat_messages'
const MAX_CHAT_MEDIA_OBJECTS = 10_000

export interface TenantMigrationMediaVerifier {
  verify(bundle: TenantMigrationBundle): Promise<void>
}

interface ChatMediaReference {
  path: string
  sizeBytes: number
}

function readChatMediaReference(row: JsonObject): ChatMediaReference | undefined {
  const path = row.image_path
  if (path === null || path === undefined) return undefined
  const sizeBytes = row.image_size_bytes
  if (
    typeof path !== 'string'
    || typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 1
    || sizeBytes > 2 * 1024 * 1024
  ) throw new TenantMigrationError('tenant_media_contract_invalid')
  return { path, sizeBytes }
}

export function chatMediaReferences(
  bundle: TenantMigrationBundle,
): readonly ChatMediaReference[] {
  const table = bundle.tables.find((candidate) => candidate.name === CHAT_TABLE)
  if (table === undefined) throw new TenantMigrationError('manifest_mismatch')
  const references = table.rows.flatMap((row) => {
    const reference = readChatMediaReference(row)
    return reference === undefined ? [] : [reference]
  })
  if (references.length > MAX_CHAT_MEDIA_OBJECTS) {
    throw new TenantMigrationError('tenant_media_limit_exceeded')
  }
  const byPath = new Map<string, ChatMediaReference>()
  for (const reference of references) {
    const existing = byPath.get(reference.path)
    if (existing !== undefined && existing.sizeBytes !== reference.sizeBytes) {
      throw new TenantMigrationError('tenant_media_contract_invalid')
    }
    byPath.set(reference.path, reference)
  }
  return [...byPath.values()]
}

export class ObjectStorageTenantMigrationMediaVerifier
implements TenantMigrationMediaVerifier {
  constructor(private readonly storage: MediaObjectStorage) {}

  async verify(bundle: TenantMigrationBundle): Promise<void> {
    for (const reference of chatMediaReferences(bundle)) {
      let stored
      try {
        stored = await this.storage.stat('chat-media', reference.path)
      } catch {
        throw new TenantMigrationError('tenant_media_validation_failed')
      }
      if (stored === undefined || stored.sizeBytes !== reference.sizeBytes) {
        throw new TenantMigrationError('tenant_media_missing')
      }
    }
  }
}
