import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'
import type { DatabasePool } from './db/types.js'
import { readYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'
import { buildYandexAiAuthorization } from './yandex-ai-authorization.js'
import type { YandexAiAuthorization } from './yandex-ai-authorization.js'

let pool: DatabasePool | undefined

export function yandexDatabasePool(): DatabasePool | undefined {
  if (pool !== undefined) return pool
  const config = buildDatabaseConnectionConfig('DATABASE')
  if (config === undefined) return undefined
  pool = new PgDatabasePool(config)
  return pool
}

export function yandexAiAuthorization(): YandexAiAuthorization | undefined {
  return buildYandexAiAuthorization()
}

export function actorSession(headers: Record<string, string | undefined>): YandexActorSession | undefined {
  return readYandexActorSession(headers)
}
