import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import { AppFeedbackDispatcher } from './app-feedback-dispatcher.js'
import { readAppFeedbackIntegrationsConfig } from './app-feedback-integrations/config.js'
import { HttpAppFeedbackSender } from './app-feedback-integrations/sender.js'
import { BackgroundDispatcher } from './background-dispatcher.js'
import { buildPushDispatcherApp } from './push-dispatcher-app.js'
import { PushDispatcher } from './push-dispatcher.js'
import { YandexPushNotificationSender } from './push-notifications/http-sender.js'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`)
  return value.trim()
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8080
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

const databaseConfig = buildDatabaseConnectionConfig('DATABASE')
if (databaseConfig === undefined) throw new Error('Dispatcher database is required')

const databasePool = new PgDatabasePool(databaseConfig)
const sender = new YandexPushNotificationSender(
  requiredEnv('PUSH_FUNCTION_URL'),
  requiredEnv('PUSH_DISPATCH_SECRET'),
)
const pushDispatcher = new PushDispatcher(databasePool, sender)
const appFeedbackConfig = readAppFeedbackIntegrationsConfig(process.env)
const dispatcher = appFeedbackConfig === undefined
  ? pushDispatcher
  : new BackgroundDispatcher(
      pushDispatcher,
      new AppFeedbackDispatcher(
        databasePool,
        new HttpAppFeedbackSender(appFeedbackConfig),
      ),
    )
const app = buildPushDispatcherApp({
  dispatcher,
  releaseId: requiredEnv('FIT_RELEASE_ID'),
})

app.addHook('onClose', () => databasePool.end())

try {
  await app.listen({ host: '0.0.0.0', port: parsePort(process.env.PORT) })
} catch (error) {
  app.log.error({ err: error }, 'Push dispatcher startup failed')
  process.exitCode = 1
}
