import type { QueryResultRow } from 'pg'

import type { DatabaseClient, DatabasePool } from './types.js'

const SUBJECT_HASH_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ActorRow extends QueryResultRow {
  profile_id: string | null
}

export class PilotAccessDeniedError extends Error {
  constructor() {
    super('Identity is not enabled for the Yandex read-only pilot')
    this.name = 'PilotAccessDeniedError'
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

  const connection = await pool.connect()
  let transactionStarted = false

  try {
    await connection.query('begin')
    transactionStarted = true

    const actorRows = await connection.query<ActorRow>(
      'select app_private.resolve_yandex_pilot_actor($1) as profile_id',
      [subjectHash],
    )
    const actorId = actorRows[0]?.profile_id
    if (actorId === null || actorId === undefined || !UUID_PATTERN.test(actorId)) {
      throw new PilotAccessDeniedError()
    }

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
