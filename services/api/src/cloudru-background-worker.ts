import { pathToFileURL } from 'node:url'
import { BackgroundDispatcher } from './background-dispatcher.js'
import { DirectPushNotificationSender } from './push-notifications/direct-sender.js'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import { PushDispatcher } from './push-dispatcher.js'
import { DatabaseSessionCleanup } from './session-cleanup.js'

export async function runCloudruBackground(): Promise<void> {
  if (process.env.FIT_MEDIA_STORAGE_PROVIDER !== 'cloudru'
    || process.env.DATABASE_HOST !== '10.70.10.67' || process.env.DATABASE_USER !== 'fit_api'
    || process.env.DATABASE_NAME !== 'fit' || process.env.DATABASE_PORT !== '5432') {
    throw new Error('cloudru_background_target_rejected')
  }
  const config = buildDatabaseConnectionConfig('DATABASE')
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env
  if (!config || !publicKey || !privateKey || !subject) throw new Error('cloudru_background_config_missing')
  const pool = new PgDatabasePool({ ...config, max: 1, statement_timeout: 10_000 }, 'dispatcher')
  try {
    const dispatcher = new BackgroundDispatcher(
      new PushDispatcher(pool, new DirectPushNotificationSender({ publicKey, privateKey, subject })),
      undefined,
      new DatabaseSessionCleanup(pool),
    )
    const result = await dispatcher.run()
    console.log(JSON.stringify({ event: 'cloudru_background_completed', ...result }))
    if (result.sessionCleanup.status === 'failed') throw new Error('cloudru_session_cleanup_failed')
  } finally { await pool.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCloudruBackground().catch(() => { console.error('cloudru_background_failed'); process.exitCode = 1 })
}
