import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './types.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ActorRow extends QueryResultRow {
  profile_id: string | null
}

type ActorResolver = (client: DatabaseClient) => Promise<string | null>

export class YandexAppSessionDeniedError extends Error {
  constructor() {
    super('Yandex identity is not linked to a read-write app rollout')
    this.name = 'YandexAppSessionDeniedError'
  }
}

export class YandexAppSessionInvalidError extends Error {
  constructor() {
    super('Yandex app session is missing, invalid, expired, or revoked')
    this.name = 'YandexAppSessionInvalidError'
  }
}

async function withResolvedYandexAppActorTransaction<Result>(
  pool: DatabasePool,
  resolveActor: ActorResolver,
  deniedError: Error,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  const connection = await pool.connect()
  let transactionStarted = false

  try {
    await connection.query('begin')
    transactionStarted = true

    const actorId = await resolveActor(connection)
    if (actorId === null || !UUID_PATTERN.test(actorId)) throw deniedError

    await connection.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [actorId],
    )

    const result = await work(connection)
    await connection.query('commit')
    return result
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.query('rollback')
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Yandex app transaction and rollback both failed',
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    connection.release()
  }
}

export async function withIssuedYandexAppSessionTransaction<Result>(
  pool: DatabasePool,
  subjectHash: string,
  tokenHash: string,
  expiresAt: Date,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  if (
    !SHA256_PATTERN.test(subjectHash)
    || !SHA256_PATTERN.test(tokenHash)
    || !Number.isFinite(expiresAt.getTime())
  ) {
    throw new YandexAppSessionDeniedError()
  }

  return withResolvedYandexAppActorTransaction(
    pool,
    async (client) => {
      const actorRows = await client.query<ActorRow>(
        `
          select app_private.create_yandex_app_session(
            $1, $2, $3
          ) as profile_id
        `,
        [subjectHash, tokenHash, expiresAt.toISOString()],
      )
      return actorRows[0]?.profile_id ?? null
    },
    new YandexAppSessionDeniedError(),
    work,
  )
}

export async function withYandexAppSessionTransaction<Result>(
  pool: DatabasePool,
  tokenHash: string,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  if (!SHA256_PATTERN.test(tokenHash)) {
    throw new YandexAppSessionInvalidError()
  }

  return withResolvedYandexAppActorTransaction(
    pool,
    async (client) => {
      const actorRows = await client.query<ActorRow>(
        'select app_private.resolve_yandex_app_session($1) as profile_id',
        [tokenHash],
      )
      return actorRows[0]?.profile_id ?? null
    },
    new YandexAppSessionInvalidError(),
    work,
  )
}
