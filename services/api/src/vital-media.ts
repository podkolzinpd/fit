import { createClient } from '@supabase/supabase-js'

import type { SupabaseBridgeConfig } from './supabase-bridge.js'

const VITAL_MEDIA_PATH = /^vital-pro\/[a-z0-9][a-z0-9-]*\.(?:jpg|mp4)$/

export interface VitalMediaSigner {
  sign(path: string): Promise<string>
}

export function readVitalMediaRequest(body: unknown): { path: string } | undefined {
  if (typeof body !== 'object' || body === null || !('path' in body)) return undefined
  return typeof body.path === 'string' && VITAL_MEDIA_PATH.test(body.path)
    ? { path: body.path }
    : undefined
}

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
