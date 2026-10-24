import type { DatabaseClient, DatabasePool } from './db/types.js'
import { backgroundDispatchDiagnostics } from './background-dispatch-error.js'

type TransactionPhase = 'connect' | 'begin' | 'timeout' | 'work' | 'commit'

function reportFailure(phase: TransactionPhase, error: unknown): void {
  // A logging sink failure must not change transaction cleanup/error identity.
  try {
    console.warn(JSON.stringify({ event: 'background_transaction_failed',
      transactionPhase: phase, ...backgroundDispatchDiagnostics(error) }))
  } catch { /* Best-effort diagnostic sink, not a swallowed database error. */ }
}

// Transaction-local limits work through transaction-pooling database proxies.
export async function withBackgroundTransaction<Result>(
  pool: DatabasePool,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  const connection = await pool.connect().catch((error: unknown) => {
    reportFailure('connect', error)
    throw error
  })
  let transactionStarted = false
  let phase: TransactionPhase = 'begin'
  try {
    await connection.query('begin')
    transactionStarted = true
    phase = 'timeout'
    await connection.query("set local statement_timeout = '10s'")
    phase = 'work'
    const result = await work(connection)
    phase = 'commit'
    await connection.query('commit')
    return result
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.query('rollback')
      } catch (rollbackError) {
        const failure = new AggregateError(
          [error, rollbackError],
          'Background transaction and rollback both failed',
          { cause: rollbackError },
        )
        reportFailure(phase, failure)
        throw failure
      }
    }
    reportFailure(phase, error)
    throw error
  } finally {
    connection.release()
  }
}
