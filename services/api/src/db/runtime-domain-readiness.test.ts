import { describe, expect, it, vi } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './types.js'
import { inspectRuntimeDomainReadiness } from './runtime-domain-readiness.js'

const ACTOR_ID = 'c9f75482-117d-4532-8f67-6c3d9b9f4a5e'

function buildPool(domainError: Error): {
  pool: DatabasePool
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
} {
  const query = vi.fn((text: string) => {
    if (text === 'select * from public.list_client_overviews($1)') {
      return Promise.reject(domainError)
    }
    return Promise.resolve([])
  })
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

describe('runtime domain readiness', () => {
  it('executes the clients read model as the stage actor and returns a safe SQL code', async () => {
    const privateError = Object.assign(
      new Error('private relation and connection details'),
      { code: '42501' },
    )
    const database = buildPool(privateError)

    const result = await inspectRuntimeDomainReadiness(database.pool, ACTOR_ID)

    expect(result).toEqual({
      ready: false,
      category: 'permission',
      code: '42501',
    })
    expect(database.query).toHaveBeenCalledWith('begin')
    expect(database.query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [ACTOR_ID],
    )
    expect(database.query).toHaveBeenCalledWith('rollback')
    expect(database.release).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('private relation')
  })

  it('normalizes application failures without exposing their message', async () => {
    const database = buildPool(new TypeError('private row value'))

    const result = await inspectRuntimeDomainReadiness(database.pool, ACTOR_ID)

    expect(result).toEqual({
      ready: false,
      category: 'unknown',
      code: 'unknown',
    })
    expect(JSON.stringify(result)).not.toContain('private row value')
  })
})
