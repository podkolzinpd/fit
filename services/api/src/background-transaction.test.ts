import { afterEach, describe, expect, it, vi } from 'vitest'
import { withBackgroundTransaction } from './background-transaction.js'
import type { DatabaseConnection } from './db/types.js'

afterEach(() => vi.restoreAllMocks())

describe('background transaction failure diagnostics', () => {
  it.each(['connect', 'begin', 'timeout', 'work', 'commit'] as const)('reports the %s boundary and preserves rollback and release', async (phase) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failure = Object.assign(new Error('private-query'), { code: '22023' })
    const statements: string[] = []
    const query: DatabaseConnection['query'] = vi.fn().mockImplementation((sql: string) => {
      statements.push(sql)
      if ((phase === 'begin' && sql === 'begin') || (phase === 'timeout' && sql.startsWith('set local'))
        || (phase === 'commit' && sql === 'commit')) throw failure
      return Promise.resolve([])
    })
    const release = vi.fn()
    const pool = { connect: () => phase === 'connect' ? Promise.reject(failure) : Promise.resolve({ query, release }), end: vi.fn() }
    await expect(withBackgroundTransaction(pool, () => phase === 'work' ? Promise.reject(failure) : Promise.resolve(1))).rejects.toBe(failure)
    expect(warn).toHaveBeenCalledOnce()
    const report: unknown = JSON.parse(String(warn.mock.calls[0]?.[0]))
    expect(report).toMatchObject({ event: 'background_transaction_failed', transactionPhase: phase, errorCode: '22023' })
    expect(JSON.stringify(report)).not.toContain('private-query')
    expect(statements.includes('rollback')).toBe(!['connect', 'begin'].includes(phase))
    expect(release).toHaveBeenCalledTimes(phase === 'connect' ? 0 : 1)
  })

  it('a failed diagnostic sink cannot replace the database error or prevent release', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('sink failed') })
    const failure = Object.assign(new Error('private'), { code: '22023' })
    const release = vi.fn()
    const pool = { connect: () => Promise.resolve({ query: vi.fn().mockResolvedValue([]), release }), end: vi.fn() }
    await expect(withBackgroundTransaction(pool, () => Promise.reject(failure))).rejects.toBe(failure)
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps the primary and rollback errors and releases after a double failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const original = Object.assign(new Error('private-work'), { code: '22023' })
    const rollback = Object.assign(new Error('private-rollback'), { code: 'ECONNRESET' })
    const release = vi.fn()
    const query = vi.fn().mockImplementation((sql: string) => sql === 'rollback' ? Promise.reject(rollback) : Promise.resolve([]))
    const pool = { connect: () => Promise.resolve({ query, release }), end: vi.fn() }
    await expect(withBackgroundTransaction(pool, () => Promise.reject(original)))
      .rejects.toMatchObject({ errors: [original, rollback] })
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      transactionPhase: 'work', errorCode: '22023', rollbackErrorCode: 'ECONNRESET',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-')
    expect(release).toHaveBeenCalledOnce()
  })
})
