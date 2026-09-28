import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import { DatabaseDomainChangeAnnouncementManager } from './domain-change-announcement.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

class Connection implements DatabaseConnection {
  calls: Array<{ text: string; values: readonly unknown[] }> = []
  result: readonly QueryResultRow[] = []
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

describe('DatabaseDomainChangeAnnouncementManager', () => {
  it.each([
    ['inspect', false],
    ['enqueue', true],
  ] as const)('runs the %s operation and returns aggregate counts', async (action, apply) => {
    const pool = new Pool()
    pool.connection.result = [{
      eligible_users: '3',
      eligible_subscriptions: '4',
      already_queued: 1,
      inserted: action === 'enqueue' ? '3' : '0',
    }]
    const manager = new DatabaseDomainChangeAnnouncementManager(pool)

    await expect(manager.run(action)).resolves.toEqual({
      eligibleUsers: 3,
      eligibleSubscriptions: 4,
      alreadyQueued: 1,
      inserted: action === 'enqueue' ? 3 : 0,
    })
    expect(pool.connection.calls).toHaveLength(1)
    expect(pool.connection.calls[0]?.text).toContain(
      'app_private.enqueue_domain_change_announcement($1)',
    )
    expect(pool.connection.calls[0]?.values).toEqual([apply])
    expect(pool.connection.released).toBe(true)
  })

  it('rejects malformed database aggregates without exposing row data', async () => {
    const pool = new Pool()
    pool.connection.result = [{
      eligible_users: '-1',
      eligible_subscriptions: '4',
      already_queued: '0',
      inserted: '0',
    }]
    const manager = new DatabaseDomainChangeAnnouncementManager(pool)

    await expect(manager.run('inspect')).rejects.toThrow(
      'Invalid domain-change announcement aggregate',
    )
    expect(pool.connection.released).toBe(true)
  })
})
