import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { DatabaseTrainerScheduleV2AutoActivator } from './trainer-schedule-v2-auto-activation.js'

class Connection implements DatabaseConnection {
  calls: Array<{ text: string; values: readonly unknown[] }> = []
  result: readonly QueryResultRow[] = [{ activated: true }]
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

describe('DatabaseTrainerScheduleV2AutoActivator', () => {
  it('delegates activation to the protected database function', async () => {
    const pool = new Pool()
    const subjectHash = 'a'.repeat(64)
    const loginHash = 'b'.repeat(64)

    await expect(new DatabaseTrainerScheduleV2AutoActivator(pool).activate(
      subjectHash,
      loginHash,
    )).resolves.toEqual({ activated: true })

    expect(pool.connection.calls).toHaveLength(1)
    expect(pool.connection.calls[0]?.text).toContain(
      'activate_trainer_schedule_v2_for_yandex_login',
    )
    expect(pool.connection.calls[0]?.values).toEqual([subjectHash, loginHash])
    expect(pool.connection.released).toBe(true)
  })

  it('does not query the database for malformed hashes', async () => {
    const pool = new Pool()

    await expect(new DatabaseTrainerScheduleV2AutoActivator(pool).activate(
      'invalid',
      'b'.repeat(64),
    )).resolves.toEqual({ activated: false })

    expect(pool.connection.calls).toHaveLength(0)
  })
})
