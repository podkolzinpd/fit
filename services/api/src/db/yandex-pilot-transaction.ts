import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './types.js'

const SUBJECT_HASH_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ActorRow extends QueryResultRow {
  profile_id: string | null
}

type ActorResolver = (client: DatabaseClient) => Promise<string | null>

export class PilotAccessDeniedError extends Error {
  constructor() {
    super('Identity is not enabled for the Yandex read-only pilot')
    this.name = 'PilotAccessDeniedError'
  }
}

export class PilotSessionInvalidError extends Error {
  constructor() {
    super('Pilot session is missing, invalid, or expired')
    this.name = 'PilotSessionInvalidError'
  }
}

async function withResolvedPilotActorTransaction<Result>(
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
          'Database transaction and rollback both failed',
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    connection.release()
  }
}

export async function withYandexPilotActorTransaction<Result>(
  pool: DatabasePool,
  subjectHash: string,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  if (!SUBJECT_HASH_PATTERN.test(subjectHash)) {
    throw new PilotAccessDeniedError()
  }

  return withResolvedPilotActorTransaction(
    pool,
    async (client) => {
      const actorRows = await client.query<ActorRow>(
        'select app_private.resolve_yandex_pilot_actor($1) as profile_id',
        [subjectHash],
      )
      return actorRows[0]?.profile_id ?? null
    },
    new PilotAccessDeniedError(),
    work,
  )
}

export async function withIssuedYandexPilotSessionTransaction<Result>(
  pool: DatabasePool,
  subjectHash: string,
  tokenHash: string,
  expiresAt: Date,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  if (
    !SUBJECT_HASH_PATTERN.test(subjectHash)
    || !SUBJECT_HASH_PATTERN.test(tokenHash)
    || !Number.isFinite(expiresAt.getTime())
  ) {
    throw new PilotAccessDeniedError()
  }

  return withResolvedPilotActorTransaction(
    pool,
    async (client) => {
      const actorRows = await client.query<ActorRow>(
        `
          select app_private.create_yandex_pilot_session(
            $1, $2, $3
          ) as profile_id
        `,
        [subjectHash, tokenHash, expiresAt.toISOString()],
      )
      return actorRows[0]?.profile_id ?? null
    },
    new PilotAccessDeniedError(),
    work,
  )
}

export async function withYandexPilotSessionTransaction<Result>(
  pool: DatabasePool,
  tokenHash: string,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  if (!SUBJECT_HASH_PATTERN.test(tokenHash)) {
    throw new PilotSessionInvalidError()
  }

  return withResolvedPilotActorTransaction(
    pool,
    async (client) => {
      const actorRows = await client.query<ActorRow>(
        'select app_private.resolve_yandex_pilot_session($1) as profile_id',
        [tokenHash],
      )
      return actorRows[0]?.profile_id ?? null
    },
    new PilotSessionInvalidError(),
    work,
  )
}
