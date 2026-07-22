import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const env = {
  ...process.env,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID:
    process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID ?? 'local-google-client-not-configured',
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET:
    process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET ?? 'local-google-secret-not-configured',
}

const result = spawnSync('supabase', process.argv.slice(2), { env, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
