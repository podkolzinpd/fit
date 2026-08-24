import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  DatabaseStageDatabaseReaderAccessManager,
  StageDatabaseReaderNotReadyError,
} from './stage-database-reader-access.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = []
  released = false
  result: readonly QueryResultRow[] = [{ applied: true }]
  failure: Error | undefined

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    if (this.failure !== undefined) return Promise.reject(this.failure)
    return Promise.resolve(this.result as readonly Row[])
  }

  release(): void {
    this.released = true
  }
}

class RecordingPool implements DatabasePool {
  readonly connection = new RecordingConnection()

  connect(): Promise<DatabaseConnection> {
    return Promise.resolve(this.connection)
  }

  end(): Promise<void> {
    return Promise.resolve()
  }
}

describe('DatabaseStageDatabaseReaderAccessManager', () => {
  it.each([
    ['grant', true],
    ['revoke', false],
  ] as const)('passes a parameterized %s request to the private function', async (
    action,
    enabled,
  ) => {
    const pool = new RecordingPool()
    const manager = new DatabaseStageDatabaseReaderAccessManager(pool)

    await manager.setAccess(action, 'stage_reader')

    expect(pool.connection.calls).toEqual([{
      text: 'select app_private.set_ops_readonly_access($1, $2) as applied',
      values: ['stage_reader', enabled],
    }])
    expect(pool.connection.released).toBe(true)
  })

  it.each(['42704', '42501'])('maps PostgreSQL %s to a safe not-ready error', async (
    code,
  ) => {
    const pool = new RecordingPool()
    pool.connection.failure = Object.assign(new Error('private details'), { code })
    const manager = new DatabaseStageDatabaseReaderAccessManager(pool)

    await expect(manager.setAccess('grant', 'stage_reader'))
      .rejects.toBeInstanceOf(StageDatabaseReaderNotReadyError)
    expect(pool.connection.released).toBe(true)
  })

  it('does not hide unexpected database failures', async () => {
    const pool = new RecordingPool()
    pool.connection.failure = new Error('connection failed')
    const manager = new DatabaseStageDatabaseReaderAccessManager(pool)

    await expect(manager.setAccess('grant', 'stage_reader'))
      .rejects.toThrow('connection failed')
    expect(pool.connection.released).toBe(true)
  })
})
