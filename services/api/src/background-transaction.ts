import type { DatabaseClient, DatabasePool } from './db/types.js'

// Transaction-local limits work through transaction-pooling database proxies.
export async function withBackgroundTransaction<Result>(
  pool: DatabasePool,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  const connection = await pool.connect()
  let transactionStarted = false
  try {
    await connection.query('begin')
    transactionStarted = true
    await connection.query("set local statement_timeout = '10s'")
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
          'Background transaction and rollback both failed',
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    connection.release()
  }
}
