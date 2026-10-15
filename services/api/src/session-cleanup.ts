import type { DatabasePool } from './db/types.js'
import { withBackgroundTransaction } from './background-transaction.js'

export interface SessionCleanupResult {
  deleted: number
}

export class DatabaseSessionCleanup {
  constructor(private readonly pool: DatabasePool) {}

  async run(): Promise<SessionCleanupResult> {
    return withBackgroundTransaction(this.pool, async (connection) => {
      // The SQL function owns the atomic fixed batch; the transaction bounds it.
      const rows = await connection.query<{ deleted: number }>(
        'select app_private.cleanup_yandex_app_sessions() as deleted',
      )
      const deleted = rows[0]?.deleted
      if (typeof deleted !== 'number' || !Number.isSafeInteger(deleted)
        || deleted < 0 || deleted > 100) {
        throw new Error('Session cleanup returned an unsupported count')
      }
      return { deleted }
    })
  }
}
