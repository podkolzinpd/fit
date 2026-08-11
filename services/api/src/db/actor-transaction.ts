import type { DatabaseClient, DatabasePool } from './types.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class InvalidActorIdError extends Error {
  constructor() {
    super('Actor ID must be a canonical UUID')
    this.name = 'InvalidActorIdError'
  }
}

export async function withActorTransaction<Result>(
  pool: DatabasePool,
  actorId: string,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  if (!UUID_PATTERN.test(actorId)) throw new InvalidActorIdError()

  const connection = await pool.connect()
  let transactionStarted = false

  try {
    await connection.query('begin')
    transactionStarted = true
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
