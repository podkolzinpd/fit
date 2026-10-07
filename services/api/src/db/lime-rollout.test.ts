import type { QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { DatabaseLimeRolloutManager, LimeRolloutConflictError, limeRolloutConfirmation, readLimeRolloutCommand } from './lime-rollout.js'
import type { DatabaseConnection, DatabasePool } from './types.js'

function fixture(rows: readonly QueryResultRow[] = [{ client_mode: 'pilot', trainer_mode: 'pilot', schedule_mode: 'pilot', revision: 0 }]) {
  const query = vi.fn<(text: string, values?: readonly unknown[]) => Promise<readonly QueryResultRow[]>>().mockResolvedValue(rows)
  const release = vi.fn()
  const connection: DatabaseConnection = { query: <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => query(text, values).then((result) => result as readonly Row[]), release }
  const pool: DatabasePool = { connect: () => Promise.resolve(connection), end: () => Promise.resolve() }
  return { manager: new DatabaseLimeRolloutManager(pool), query, release }
}

describe('bounded private Lime rollout control', () => {
  it.each(['client', 'trainer', 'trainer-schedule'] as const)('permits inspect without any mutation fields: %s', (target) => {
    expect(readLimeRolloutCommand({ target, mode: 'inspect' })).toEqual({ target, mode: 'inspect' })
  })
  it.each(['client', 'trainer', 'trainer-schedule'] as const)('requires exact confirmation and revision for every mutation: %s', (target) => {
    for (const mode of ['all', 'off', 'pilot'] as const) {
      const body = { target, mode, expectedRevision: 3, confirmation: limeRolloutConfirmation(target, mode) }
      expect(readLimeRolloutCommand(body)).toEqual({ target, mode, expectedRevision: 3 })
      expect(readLimeRolloutCommand({ ...body, confirmation: '' })).toBeUndefined()
      expect(readLimeRolloutCommand({ ...body, unexpected: true })).toBeUndefined()
    }
  })
  it.each([null, {}, { target: 'client', mode: 'all' }, { target: 'client', mode: 'inspect', expectedRevision: 0 },
    { target: 'unknown', mode: 'inspect' }, { target: 'client', mode: 'all', confirmation: 'SET_CLIENT_LIME_ALL', expectedRevision: -1 },
    { target: 'client', mode: 'all', confirmation: 'SET_CLIENT_LIME_ALL', expectedRevision: 1.5 },
    { target: 'client', mode: 'all', confirmation: 'SET_CLIENT_LIME_ALL', expectedRevision: 2_147_483_647 }])('rejects malformed or unconfirmed request %j', (body) => {
    expect(readLimeRolloutCommand(body)).toBeUndefined()
  })
  it('inspection is read-only and returns only modes/revision', async () => {
    const { manager, query, release } = fixture()
    expect(await manager.apply({ target: 'client', mode: 'inspect' })).toEqual({ clientMode: 'pilot', trainerMode: 'pilot', scheduleMode: 'pilot', revision: 0 })
    expect(query.mock.calls[0]?.[0]).toMatch(/^select client_mode/)
    expect(release).toHaveBeenCalledOnce()
  })
  it('uses parameterized owner operation and releases the connection', async () => {
    const { manager, query, release } = fixture()
    await manager.apply({ target: 'client', mode: 'all', expectedRevision: 0 })
    expect(query).toHaveBeenCalledWith('select * from app_private.set_lime_rollout_mode($1, $2, $3)', ['client', 'all', 0])
    expect(release).toHaveBeenCalledOnce()
  })
  it('maps revision/dependency conflicts without exposing SQL', async () => {
    const { manager, query, release } = fixture()
    query.mockRejectedValueOnce({ code: 'PT409', detail: 'private' })
    await expect(manager.apply({ target: 'trainer', mode: 'all', expectedRevision: 0 })).rejects.toBeInstanceOf(LimeRolloutConflictError)
    expect(release).toHaveBeenCalledOnce()
  })
  it.each([{ rows: [] }, { rows: [{ client_mode: 'unknown', trainer_mode: 'pilot', schedule_mode: 'pilot', revision: 0 }] },
    { rows: [{ client_mode: 'pilot', trainer_mode: 'all', schedule_mode: 'off', revision: 1 }] }])('rejects incomplete/dependency-invalid database state', async ({ rows }) => {
    const { manager, release } = fixture(rows)
    await expect(manager.apply({ target: 'client', mode: 'inspect' })).rejects.toThrow('Invalid Lime rollout state')
    expect(release).toHaveBeenCalledOnce()
  })
})
