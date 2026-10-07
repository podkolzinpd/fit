import type { DatabasePool } from './db/types.js'

export interface SessionCleanupResult {
  deleted: number
}

export class DatabaseSessionCleanup {
  constructor(private readonly pool: DatabasePool) {}

  async run(): Promise<SessionCleanupResult> {
    const connection = await this.pool.connect()
    try {
      // One autocommit statement: the SQL function owns the atomic fixed batch.
      const rows = await connection.query<{ deleted: number }>(
        'select app_private.cleanup_yandex_app_sessions() as deleted',
      )
      const deleted = rows[0]?.deleted
      if (typeof deleted !== 'number' || !Number.isSafeInteger(deleted)
        || deleted < 0 || deleted > 100) {
        throw new Error('Session cleanup returned an unsupported count')
      }
      return { deleted }
    } finally {
      connection.release()
    }
  }
}
