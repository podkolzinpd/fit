import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { createAuthFetch } from './auth-fetch'
import { assertSafeSupabaseUrl } from './supabase-environment'

type LegacyClient = SupabaseClient<Database>
let client: LegacyClient | undefined

function legacyClient(): LegacyClient {
  // Production uses app-session/API only, even if an old env file is present.
  if (import.meta.env.MODE !== 'development' && import.meta.env.MODE !== 'test') {
    throw new Error('Устаревший источник данных недоступен в этой сборке.')
  }
  if (client !== undefined) return client
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
    ?? (import.meta.env.MODE === 'test' ? 'http://127.0.0.1:54321' : undefined)
  const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
    ?? (import.meta.env.MODE === 'test' ? 'test-publishable-key' : undefined)
  if (!url || !publishableKey) throw new Error('Локальный Supabase не настроен.')
  assertSafeSupabaseUrl(url, true)
  client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: createAuthFetch() },
  })
  return client
}

// Imports must be safe without legacy configuration. Only an explicit local
// legacy operation can create the SDK client; native routes never access it.
export const supabase: Pick<LegacyClient, 'auth' | 'storage' | 'functions' | 'from' | 'rpc' | 'channel' | 'removeChannel'> = {
  get auth() { return legacyClient().auth },
  get storage() { return legacyClient().storage },
  get functions() { return legacyClient().functions },
  get from() { const instance = legacyClient(); return instance.from.bind(instance) },
  get rpc() { const instance = legacyClient(); return instance.rpc.bind(instance) },
  get channel() { const instance = legacyClient(); return instance.channel.bind(instance) },
  get removeChannel() { const instance = legacyClient(); return instance.removeChannel.bind(instance) },
}
