import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  InvalidActorIdError,
  withActorTransaction,
} from './actor-transaction.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

const ACTOR_ID = 'a8e4d5cf-f021-4bfd-bd9e-62b1c30785c4'

class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = []
  released = false
  failOn: string | null = null

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    if (text === this.failOn) {
      return Promise.reject(new Error(`Failed query: ${text}`))
    }
    return Promise.resolve([])
  }

  release(): void {
    this.released = true
  }
}

class RecordingPool implements DatabasePool {
  readonly connection = new RecordingConnection()
  connectCount = 0

  connect(): Promise<DatabaseConnection> {
    this.connectCount += 1
    return Promise.resolve(this.connection)
  }

  end(): Promise<void> {
    return Promise.resolve()
  }
}

describe('withActorTransaction', () => {
  it('sets the internal actor only inside the transaction', async () => {
    const pool = new RecordingPool()

    const result = await withActorTransaction(pool, ACTOR_ID, async (client) => {
      await client.query('select auth.uid()')
      return 'done'
    })

    expect(result).toBe('done')
    expect(pool.connection.calls).toEqual([
      { text: 'begin', values: [] },
      {
        text: "select set_config('request.jwt.claim.sub', $1, true)",
        values: [ACTOR_ID],
      },
      { text: 'select auth.uid()', values: [] },
      { text: 'commit', values: [] },
    ])
    expect(pool.connection.released).toBe(true)
  })

  it('rejects a provider subject before opening a database connection', async () => {
    const pool = new RecordingPool()

    await expect(
      withActorTransaction(pool, 'yandex-id-subject', () =>
        Promise.resolve(undefined),
      ),
    ).rejects.toBeInstanceOf(InvalidActorIdError)
    expect(pool.connectCount).toBe(0)
  })

  it('rolls back and releases the connection when work fails', async () => {
    const pool = new RecordingPool()

    await expect(
      withActorTransaction(pool, ACTOR_ID, () =>
        Promise.reject(new Error('domain failure')),
      ),
    ).rejects.toThrow('domain failure')

    expect(pool.connection.calls.at(-1)).toEqual({
      text: 'rollback',
      values: [],
    })
    expect(pool.connection.released).toBe(true)
  })

  it('rolls back a failed commit', async () => {
    const pool = new RecordingPool()
    pool.connection.failOn = 'commit'

    await expect(
      withActorTransaction(pool, ACTOR_ID, () => Promise.resolve('done')),
    ).rejects.toThrow('Failed query: commit')

    expect(pool.connection.calls.at(-1)?.text).toBe('rollback')
    expect(pool.connection.released).toBe(true)
  })
})
