import manifest from './whisper-model-manifest.json'

export const WHISPER_MODEL_CACHE_KEY = `fit-whisper-${manifest.sha256}`
export const WHISPER_MODEL_BYTES = manifest.bytes

export function getWhisperModelUrl() {
  const env = import.meta.env as unknown as { VITE_SUPABASE_URL?: string }
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required to load the speech model')
  return `${supabaseUrl}/storage/v1/object/public/${manifest.bucket}/${manifest.path}`
}
