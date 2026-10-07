import { describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection } from './db/types.js'
import { DatabaseSessionCleanup } from './session-cleanup.js'

function fixture() {
  const query = vi.fn<DatabaseConnection['query']>()
  const release = vi.fn()
  const connect = vi.fn().mockResolvedValue({ query, release })
  return { query, release, connect, cleanup: new DatabaseSessionCleanup({ connect, end: vi.fn() }) }
}

describe('DatabaseSessionCleanup', () => {
  it.each([0, 1, 100])('accepts a bounded deletion count of %i and releases the connection', async (deleted) => {
    const { query, release, cleanup } = fixture()
    query.mockResolvedValue([{ deleted }])
    await expect(cleanup.run()).resolves.toEqual({ deleted })
    expect(query).toHaveBeenCalledExactlyOnceWith('select app_private.cleanup_yandex_app_sessions() as deleted')
    expect(release).toHaveBeenCalledOnce()
  })

  it.each([undefined, '2', -1, 101, NaN, 0.5])('rejects unsupported counts without leaking response details', async (deleted) => {
    const { query, release, cleanup } = fixture()
    query.mockResolvedValue([{ deleted }])
    await expect(cleanup.run()).rejects.toThrow('unsupported count')
    expect(release).toHaveBeenCalledOnce()
  })

  it('releases after a query failure and does not retry', async () => {
    const { query, release, cleanup } = fixture()
    const failure = new Error('database unavailable')
    query.mockRejectedValue(failure)
    await expect(cleanup.run()).rejects.toBe(failure)
    expect(query).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('propagates acquisition failure without releasing an unacquired connection', async () => {
    const { connect, release, cleanup } = fixture()
    const failure = new Error('pool unavailable')
    connect.mockRejectedValue(failure)
    await expect(cleanup.run()).rejects.toBe(failure)
    expect(release).not.toHaveBeenCalled()
  })
})
