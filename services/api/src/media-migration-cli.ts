import process from 'node:process'

import { migrateMedia, readMediaMigrationMode, SupabaseLegacyMediaSource } from './media-migration.js'
import { readYandexMediaStorageConfig, YandexMediaObjectStorage } from './object-storage-media.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('media_migration_configuration_missing')
  return value
}

async function main(): Promise<void> {
  const mode = readMediaMigrationMode(process.env.FIT_MEDIA_MIGRATION_MODE)
  const sourceUrl = required('SUPABASE_URL')
  const sourceKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const targetConfig = readYandexMediaStorageConfig()
  if (targetConfig === undefined) {
    throw new Error('media_migration_configuration_missing')
  }
  const result = await migrateMedia(
    new SupabaseLegacyMediaSource(sourceUrl, sourceKey),
    new YandexMediaObjectStorage(targetConfig),
    mode,
  )
  process.stdout.write(`${JSON.stringify({ mode, ...result })}\n`)
}

try {
  await main()
} catch (error) {
  const code = error instanceof Error && /^[a-z0-9_]{1,96}$/.test(error.message)
    ? error.message
    : 'media_migration_failed'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
}
