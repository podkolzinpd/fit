import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

export function validateIosProductionEnv(environment) {
  const errors = []
  const supabaseUrl = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!supabaseUrl) {
    errors.push('VITE_SUPABASE_URL is missing')
  } else {
    try {
      const parsed = new URL(supabaseUrl)
      if (parsed.protocol !== 'https:') errors.push('VITE_SUPABASE_URL must use HTTPS')
      if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
        errors.push('VITE_SUPABASE_URL must not point to local Supabase')
      }
    } catch {
      errors.push('VITE_SUPABASE_URL is invalid')
    }
  }

  if (!publishableKey) errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing')
  return errors
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = validateIosProductionEnv(loadEnv('production', process.cwd(), ''))
  if (errors.length > 0) {
    console.error(`iOS production build stopped: ${errors.join('; ')}`)
    process.exit(1)
  }
  console.log('iOS production environment is configured')
}
