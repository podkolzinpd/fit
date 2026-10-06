import type { QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { DatabaseTrainerLimeCohortManager } from './trainer-lime-cohort.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

function fixture(results: readonly QueryResultRow[] = [{ approved_rows: 3, added: true }]) {
  const query = vi.fn(() => Promise.resolve(results))
  const release = vi.fn()
  const connection: DatabaseConnection = {
    query: <Row extends QueryResultRow>() => query().then((rows) => rows as readonly Row[]),
    release,
  }
  const connect = vi.fn(() => Promise.resolve(connection))
  const pool: DatabasePool = { connect, end: () => Promise.resolve() }
  return { manager: new DatabaseTrainerLimeCohortManager(pool), connect, query, release }
}

describe('private trainer Lime cohort manager', () => {
  it('returns only bounded counts and releases the owner connection', async () => {
    const { manager, release } = fixture()
    await expect(manager.enroll('d'.repeat(64))).resolves.toEqual({ approvedRows: 3, added: true })
    expect(release).toHaveBeenCalledOnce()
  })

  it.each(['', 'd'.repeat(63), 'D'.repeat(64), 'not-a-login-hash'])('rejects malformed keys before connecting', async (key) => {
    const { manager, connect } = fixture()
    await expect(manager.enroll(key)).rejects.toThrow('Invalid reviewed trainer key')
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([{ rows: [] }, { rows: [{ approved_rows: 4, added: true }] }])('rejects missing or excessive cohort results', async ({ rows }) => {
    const { manager, release } = fixture(rows)
    await expect(manager.enroll('d'.repeat(64))).rejects.toThrow('cohort invariant')
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases the connection after database rejection', async () => {
    const { manager, query, release } = fixture()
    query.mockRejectedValueOnce(new Error('cohort full'))
    await expect(manager.enroll('d'.repeat(64))).rejects.toThrow('cohort full')
    expect(release).toHaveBeenCalledOnce()
  })
})
