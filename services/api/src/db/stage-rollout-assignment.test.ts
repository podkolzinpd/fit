import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  DatabaseStageRolloutAssignmentManager,
  StageRolloutProfileNotReadyError,
} from './stage-rollout-assignment.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = []
  released = false
  results: Array<readonly QueryResultRow[]> = []

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    return Promise.resolve((this.results.shift() ?? []) as readonly Row[])
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

const PROFILE_ID = '10000000-0000-4000-8000-000000000001'

function readyPool(identityLinked = false): RecordingPool {
  const pool = new RecordingPool()
  pool.connection.results = [
    [],
    [],
    [{
      account_role: 'trainer',
      domain_ready: true,
      identity_linked: identityLinked,
    }],
  ]
  return pool
}

describe('DatabaseStageRolloutAssignmentManager', () => {
  it('inspects an existing assignment without changing it', async () => {
    const pool = readyPool(true)
    pool.connection.results.push([{ rollout_enabled: true }], [])
    const manager = new DatabaseStageRolloutAssignmentManager(pool)

    await expect(manager.apply('inspect', PROFILE_ID)).resolves.toEqual({
      accountRole: 'trainer',
      domainReady: true,
      identityLinked: true,
      rolloutEnabled: true,
    })

    expect(pool.connection.calls).toHaveLength(5)
    expect(pool.connection.calls[3]?.text).toContain('bool_or')
    expect(pool.connection.calls[3]?.values).toEqual([PROFILE_ID])
    expect(pool.connection.calls.every(({ text }) => !text.includes('insert into')))
      .toBe(true)
    expect(pool.connection.released).toBe(true)
  })

  it.each([
    ['enable', true],
    ['disable', false],
  ] as const)('applies an idempotent %s assignment', async (action, enabled) => {
    const pool = readyPool()
    pool.connection.results.push([], [])
    const manager = new DatabaseStageRolloutAssignmentManager(pool)

    await expect(manager.apply(action, PROFILE_ID)).resolves.toEqual({
      accountRole: 'trainer',
      domainReady: true,
      identityLinked: false,
      rolloutEnabled: enabled,
    })

    expect(pool.connection.calls[3]?.text).toContain(
      'insert into app_private.profile_rollout_assignments',
    )
    expect(pool.connection.calls[3]?.values).toEqual([PROFILE_ID, enabled])
    expect(pool.connection.calls[4]?.text).toBe('commit')
    expect(pool.connection.released).toBe(true)
  })

  it('rejects a profile whose domain root was not migrated and rolls back', async () => {
    const pool = new RecordingPool()
    pool.connection.results = [
      [],
      [],
      [{
        account_role: 'trainer',
        domain_ready: false,
        identity_linked: false,
      }],
      [],
    ]
    const manager = new DatabaseStageRolloutAssignmentManager(pool)

    await expect(manager.apply('enable', PROFILE_ID))
      .rejects.toBeInstanceOf(StageRolloutProfileNotReadyError)

    expect(pool.connection.calls[3]?.text).toBe('rollback')
    expect(pool.connection.calls.every(({ text }) => !text.includes('insert into')))
      .toBe(true)
    expect(pool.connection.released).toBe(true)
  })
})
