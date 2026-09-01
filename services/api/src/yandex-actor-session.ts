import { hashPilotSessionToken } from './auth/pilot-session-token.js'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import {
  PilotSessionInvalidError,
  withYandexPilotSessionTransaction,
} from './db/yandex-pilot-transaction.js'
import {
  YandexAppSessionInvalidError,
  withYandexAppSessionTransaction,
} from './db/yandex-app-transaction.js'

export type YandexActorSession = {
  accessMode: 'read_only' | 'read_write'
  token: string
}

type SessionHeaders = {
  [name: string]: string | string[] | undefined
  'x-fit-pilot-session'?: string | string[]
  'x-fit-session'?: string | string[]
}

export type YandexActorSessionInput = YandexActorSession | string

export function readYandexActorSession(
  headers: SessionHeaders,
): YandexActorSession | undefined {
  const pilotToken = headers['x-fit-pilot-session']
  const appToken = headers['x-fit-session']
  const hasPilotToken = typeof pilotToken === 'string' && pilotToken.length > 0
  const hasAppToken = typeof appToken === 'string' && appToken.length > 0

  // Не выбираем один credential неявно: одновременная отправка двух сессий
  // считается некорректным запросом и не может изменить actor context.
  if (hasPilotToken === hasAppToken) return undefined
  return hasAppToken
    ? { accessMode: 'read_write', token: appToken }
    : { accessMode: 'read_only', token: pilotToken as string }
}

export function withYandexActorSession<Result>(
  pool: DatabasePool,
  input: YandexActorSessionInput,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  const session = typeof input === 'string'
    ? { accessMode: 'read_only' as const, token: input }
    : input
  const tokenHash = hashPilotSessionToken(session.token)
  if (tokenHash === undefined) {
    throw session.accessMode === 'read_write'
      ? new YandexAppSessionInvalidError()
      : new PilotSessionInvalidError()
  }
  return session.accessMode === 'read_write'
    ? withYandexAppSessionTransaction(pool, tokenHash, work)
    : withYandexPilotSessionTransaction(pool, tokenHash, work)
}
