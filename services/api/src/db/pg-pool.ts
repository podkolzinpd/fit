import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg'

import type { DatabaseConnection, DatabasePool } from './types.js'

class PgDatabaseConnection implements DatabaseConnection {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    const result = await this.client.query<Row>(text, [...values])
    return result.rows
  }

  release(): void {
    this.client.release()
  }
}

export class PgDatabasePool implements DatabasePool {
  private readonly pool: Pool

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ...config,
    })
  }

  async connect(): Promise<DatabaseConnection> {
    return new PgDatabaseConnection(await this.pool.connect())
  }

  async end(): Promise<void> {
    await this.pool.end()
  }
}
