import type { DatabasePool } from './db/types.js'

export class DatabasePrivateAnalyticsLoginObserver {
  constructor(private readonly pool: DatabasePool) {}

  async observe(subjectHash: string, loginHash: string): Promise<void> {
    const connection = await this.pool.connect()
    try {
      await connection.query('select app_private.bind_private_analytics_login($1,$2)', [subjectHash, loginHash])
    } finally {
      connection.release()
    }
  }
}
