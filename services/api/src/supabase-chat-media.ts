import { createClient } from '@supabase/supabase-js'

import type { ChatImageUpload, ChatMediaStore } from './chat-media.js'
import type { SupabaseBridgeConfig } from './supabase-bridge.js'

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

  async remove(path: string): Promise<void> {
    const { error } = await this.storage.remove([path])
    if (error && !/not found/i.test(error.message)) throw new Error('chat_media_delete_failed')
  }
}
