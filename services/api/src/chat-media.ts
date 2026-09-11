import { createClient } from '@supabase/supabase-js'

import type { SupabaseBridgeConfig } from './supabase-bridge.js'

export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024

export type ChatImageUpload = {
  bytes: Uint8Array
  mimeType: 'image/jpeg'
  width: number
  height: number
  sizeBytes: number
}

export interface ChatMediaStore {
  upload(path: string, image: ChatImageUpload): Promise<void>
  sign(path: string): Promise<string>
}

export function readChatImageUpload(value: unknown): ChatImageUpload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { dataUrl?: unknown; mimeType?: unknown; width?: unknown; height?: unknown; sizeBytes?: unknown }
  if (candidate.mimeType !== 'image/jpeg' || typeof candidate.dataUrl !== 'string'
    || !candidate.dataUrl.startsWith('data:image/jpeg;base64,')
    || !Number.isInteger(candidate.width) || !Number.isInteger(candidate.height) || !Number.isInteger(candidate.sizeBytes)) return undefined
  const width = candidate.width as number
  const height = candidate.height as number
  const claimedSize = candidate.sizeBytes as number
  if (width < 1 || width > 4096 || height < 1 || height > 4096 || claimedSize < 1 || claimedSize > CHAT_IMAGE_MAX_BYTES) return undefined
  const encoded = candidate.dataUrl.slice('data:image/jpeg;base64,'.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength !== claimedSize || bytes.byteLength > CHAT_IMAGE_MAX_BYTES) return undefined
  return { bytes, mimeType: 'image/jpeg', width, height, sizeBytes: bytes.byteLength }
}

export class SupabaseChatMediaStore implements ChatMediaStore {
  private readonly storage

  constructor(config: SupabaseBridgeConfig) {
    this.storage = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from('chat-media')
  }

  async upload(path: string, image: ChatImageUpload): Promise<void> {
    const { error } = await this.storage.upload(path, image.bytes, { contentType: image.mimeType, upsert: false })
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error('chat_media_upload_failed')
  }

  async sign(path: string): Promise<string> {
    const { data, error } = await this.storage.createSignedUrl(path, 60 * 60)
    if (error || !data?.signedUrl) throw new Error('chat_media_signing_failed')
    return data.signedUrl
  }
}
