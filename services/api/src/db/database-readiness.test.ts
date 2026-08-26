import { describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './types.js'
import { inspectDatabaseReadiness } from './database-readiness.js'

function buildPool(error?: unknown): {
  pool: DatabasePool
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
} {
  const query = error === undefined
    ? vi.fn().mockResolvedValue([])
    : vi.fn().mockRejectedValue(error)
  const release = vi.fn()
  const connection: DatabaseConnection = { query, release }
  return {
    pool: {
      connect: vi.fn().mockResolvedValue(connection),
      end: vi.fn().mockResolvedValue(undefined),
    },
    query,
    release,
  }
}

describe('database readiness inspection', () => {
  it('probes and releases a successful runtime connection', async () => {
    const database = buildPool()

    await expect(inspectDatabaseReadiness(database.pool)).resolves.toEqual({
      ready: true,
    })
    expect(database.query).toHaveBeenCalledWith('select 1')
    expect(database.release).toHaveBeenCalledOnce()
  })

  it.each([
    ['28P01', 'authentication'],
    ['42501', 'permission'],
    ['08006', 'network'],
    ['ETIMEDOUT', 'network'],
    ['CERT_HAS_EXPIRED', 'tls'],
    ['unexpected', 'unknown'],
  ] as const)('reports only a safe %s failure category', async (code, category) => {
    const error = Object.assign(new Error('private host user password'), { code })
    const database = buildPool(error)

    const result = await inspectDatabaseReadiness(database.pool)

    expect(result).toEqual({
      ready: false,
      category,
      code: code === 'unexpected' ? 'unknown' : code,
    })
    expect(JSON.stringify(result)).not.toContain('private host user password')
    expect(database.release).toHaveBeenCalledOnce()
  })

  it('classifies a connection failure and never exposes arbitrary codes', async () => {
    const error = Object.assign(new Error('postgresql://fit_api:secret@host'), {
      code: 'unsafe\nvalue',
    })
    const pool: DatabasePool = {
      connect: vi.fn().mockRejectedValue(error),
      end: vi.fn().mockResolvedValue(undefined),
    }

    const result = await inspectDatabaseReadiness(pool)

    expect(result).toEqual({ ready: false, category: 'unknown', code: 'unknown' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
