import { describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { PilotSessionInvalidError } from './db/yandex-pilot-transaction.js'
import { YandexAppSessionInvalidError } from './db/yandex-app-transaction.js'
import { DatabasePilotTrainingDataReader } from './pilot-training-data-reader.js'
import { withYandexActorSession, type YandexActorSession } from './yandex-actor-session.js'

const ACTOR_ID = 'a8e4d5cf-f021-4bfd-bd9e-62b1c30785c4'
const TOKEN = 'A'.repeat(43)

function fixture(authorized = true) {
  const query = vi.fn<DatabaseConnection['query']>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(authorized ? [{ profile_id: ACTOR_ID }] : [])
    .mockResolvedValue([])
  const release = vi.fn()
  const pool: DatabasePool = {
    // Vitest's Mock collapses generic return types; the fixture supplies only
    // the resolver rows and empty product rows expected by this reader.
    connect: () => Promise.resolve({ query: query as DatabaseConnection['query'], release }),
    end: () => Promise.resolve(),
  }
  return { pool, query, release }
}

describe('training data snapshot transaction', () => {
  it.each(['read_only', 'read_write'] as const)('reads %s in a snapshot established before resolving actor', async (accessMode) => {
    const { pool, query, release } = fixture()
    const result = await new DatabasePilotTrainingDataReader(pool).readTrainingData({ accessMode, token: TOKEN })
    expect(query.mock.calls[0]?.[0]).toBe('begin isolation level repeatable read read only')
    expect(query.mock.calls[1]?.[0]).toContain(accessMode === 'read_write'
      ? 'resolve_yandex_app_session' : 'resolve_yandex_pilot_session')
    expect(query.mock.calls[2]).toEqual(["select set_config('request.jwt.claim.sub', $1, true)", [ACTOR_ID]])
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit')
    expect(release).toHaveBeenCalledExactlyOnceWith()
    expect(result).toMatchObject({ workouts: [], hasMoreWorkouts: false, totalWorkouts: 0 })
  })

  it.each(['read_only', 'read_write'] as const)('rejects an invalid %s session without querying product tables', async (accessMode) => {
    const { pool, query, release } = fixture(false)
    await expect(new DatabasePilotTrainingDataReader(pool).readTrainingData({ accessMode, token: TOKEN }))
      .rejects.toBeInstanceOf(accessMode === 'read_write' ? YandexAppSessionInvalidError : PilotSessionInvalidError)
    expect(query.mock.calls.map(([text]) => text)).toHaveLength(3)
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback')
    expect(release).toHaveBeenCalledExactlyOnceWith()
  })

  it('rolls back a failed aggregate read without returning a partial response', async () => {
    const { pool, query, release } = fixture()
    query.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Training query failed'))
    await expect(new DatabasePilotTrainingDataReader(pool).readTrainingData(TOKEN))
      .rejects.toThrow('Training query failed')
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback')
    expect(release).toHaveBeenCalledExactlyOnceWith()
  })

  it.each(['read_only', 'read_write'] as const)('keeps ordinary %s actor transactions unchanged', async (accessMode) => {
    const { pool, query } = fixture()
    const session: YandexActorSession = { accessMode, token: TOKEN }
    await withYandexActorSession(pool, session, () => Promise.resolve('done'))
    expect(query.mock.calls[0]?.[0]).toBe('begin')
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit')
  })
})
