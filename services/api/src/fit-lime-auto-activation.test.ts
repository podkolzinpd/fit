import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { DatabaseFitLimeAutoActivator } from './fit-lime-auto-activation.js'

class Connection implements DatabaseConnection {
  calls: Array<{ text: string; values: readonly unknown[] }> = []
  result: readonly QueryResultRow[] = [{ bound: true }]
  released = false

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    return Promise.resolve(this.result as readonly Row[])
  }

  release() { this.released = true }
}

class Pool implements DatabasePool {
  connection = new Connection()
  connect() { return Promise.resolve(this.connection) }
  end() { return Promise.resolve() }
}

describe('DatabaseFitLimeAutoActivator', () => {
  it('binds only a verified login hash through its independent protected function', async () => {
    const pool = new Pool()
    const subjectHash = 'a'.repeat(64)
    const loginHash = 'b'.repeat(64)

    await expect(new DatabaseFitLimeAutoActivator(pool).bind(subjectHash, loginHash))
      .resolves.toEqual({ bound: true })

    expect(pool.connection.calls).toHaveLength(1)
    expect(pool.connection.calls[0]?.text).toContain('bind_fit_lime_for_yandex_login')
    expect(pool.connection.calls[0]?.text).toContain('bind_client_lime_for_yandex_login')
    expect(pool.connection.calls[0]?.values).toEqual([subjectHash, loginHash])
    expect(pool.connection.released).toBe(true)
  })

  it('rejects malformed hashes without querying the database', async () => {
    const pool = new Pool()
    await expect(new DatabaseFitLimeAutoActivator(pool).bind('bad', 'b'.repeat(64)))
      .resolves.toEqual({ bound: false })
    expect(pool.connection.calls).toHaveLength(0)
  })
})
