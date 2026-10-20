import { createClient } from '@supabase/supabase-js'

import type { VitalMediaSigner } from './vital-media.js'
import type { SupabaseBridgeConfig } from './supabase-bridge.js'

export class SupabaseVitalMediaSigner implements VitalMediaSigner {
  private readonly storage

  constructor(config: SupabaseBridgeConfig) {
    this.storage = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from('fit-exercise-media')
  }

  async sign(path: string): Promise<string> {
    const { data, error } = await this.storage.createSignedUrl(path, 60 * 60)
    if (error || !data?.signedUrl) throw new Error('vital_media_signing_failed')
    return data.signedUrl
  }
}
