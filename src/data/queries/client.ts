import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? (import.meta.env.MODE === 'test' ? 'http://127.0.0.1:54321' : undefined)
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? (import.meta.env.MODE === 'test' ? 'test-publishable-key' : undefined)

if (!url || !publishableKey) {
  throw new Error('Задайте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY')
}

export const supabase = createClient<Database>(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
