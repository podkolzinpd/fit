import { Client, Pool, type PoolClient } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PgDatabasePool } from './pg-pool.js'

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => undefined))

function buildDatabase(role: 'api' | 'dispatcher' = 'api', config = {}) {
  const subscribe = vi.spyOn(Pool.prototype, 'on')
  const database = new PgDatabasePool(config, role)
  const pool = subscribe.mock.contexts.at(-1)
  if (!(pool instanceof Pool)) throw new Error('Expected a real PostgreSQL pool')
  const release = vi.fn()
  const client = Object.assign(new Client(), { release })
  // Pick the promise overload without casting away the real pg Pool contract.
  const connectionSource: { connect: () => Promise<PoolClient> } = pool
  const connect = vi.spyOn(connectionSource, 'connect').mockResolvedValue(client)
  return { database, pool, client, release, connect }
}

describe('PostgreSQL background connection errors', () => {
  it('handles repeated pool errors without throwing or exposing connection details', async () => {
    const subscribe = vi.spyOn(Pool.prototype, 'on')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const database = new PgDatabasePool({})
    const pool = subscribe.mock.contexts[0]
    if (!(pool instanceof Pool)) throw new Error('Expected a real PostgreSQL pool')

    try {
      const error = Object.assign(new Error('postgresql://private:secret@host/db'), {
        code: 'ECONNRESET',
        detail: 'private query values',
      })
      expect(() => pool.emit('error', error)).not.toThrow()
      expect(() => pool.emit('error', error)).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(3)
      expect(warn).toHaveBeenCalledWith(JSON.stringify({
        level: 'WARN',
        event: 'database_pool_idle_error',
        poolRole: 'unspecified',
        databaseErrorCategory: 'network',
        databaseErrorCode: 'ECONNRESET',
      }))
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private|host/)
      warn.mockImplementationOnce(() => { throw new Error('output closed') })
      expect(() => pool.emit('error', error)).not.toThrow()
    } finally {
      await database.end()
    }
  })
})

describe('PostgreSQL pool diagnostics', () => {
  it.each(['api', 'dispatcher'] as const)('reports %s defaults, acquisition and occupancy without changing release', async (role) => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { database, pool, client, release, connect } = buildDatabase(role)
    vi.spyOn(pool, 'totalCount', 'get').mockReturnValue(1)
    vi.spyOn(pool, 'idleCount', 'get').mockReturnValue(0)
    connect.mockImplementation(() => {
      clock.mockReturnValue(25)
      return Promise.resolve(client)
    })

    const connection = await database.connect()
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"poolRole":"' + role + '"'))
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"acquireMaxMs":25'))
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"occupiedMax":1'))
    expect(pool.options).toMatchObject({ max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 })
    connection.release()
    expect(release).toHaveBeenCalledOnce()
    await database.end()
  })

  it('samples the synchronously queued request and reports aggregated results at the next minute', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { database, pool, client, connect } = buildDatabase()
    ;(await database.connect()).release()
    vi.spyOn(pool, 'totalCount', 'get').mockReturnValue(5)
    vi.spyOn(pool, 'idleCount', 'get').mockReturnValue(0)
    let waiting = 0
    vi.spyOn(pool, 'waitingCount', 'get').mockImplementation(() => waiting)
    connect.mockImplementation(() => {
      waiting = 1
      return Promise.resolve(client).then((resolved) => {
        waiting = 0
        clock.mockReturnValue(200)
        return resolved
      })
    })
    const queued = await database.connect()
    queued.release()
    expect(console.info).toHaveBeenCalledOnce()
    clock.mockReturnValue(60_000)
    connect.mockResolvedValue(client)
    ;(await database.connect()).release()
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('"waitingMax":1'))
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('"acquired":2'))
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('"acquireTotalMs":200'))
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('"occupiedMax":5'))
    await database.end()
  })

  it('rethrows the original capacity failure and bounds failure summaries while preserving counts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { database, connect } = buildDatabase()
    ;(await database.connect()).release()
    const error = Object.assign(new Error('postgresql://private:secret@host/db'), { code: '53300', detail: 'private SQL' })
    connect.mockRejectedValue(error)
    clock.mockReturnValue(10)
    await expect(database.connect()).rejects.toBe(error)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"databaseErrorCategory":"capacity"'))
    for (let index = 0; index < 20; index += 1) {
      await expect(database.connect()).rejects.toBe(error)
    }
    expect(warn).toHaveBeenCalledOnce()
    clock.mockReturnValue(60_010)
    await expect(database.connect()).rejects.toBe(error)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('"acquireErrors":21'))
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('"capacityErrors":21'))
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private|host/)
    await database.end()
  })

  it('records elapsed failed acquisition without parsing a driver timeout message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { database, connect } = buildDatabase()
    const error = new Error('timeout exceeded when trying to connect: private host')
    connect.mockImplementation(() => {
      clock.mockReturnValue(5000)
      return Promise.reject(error)
    })
    await expect(database.connect()).rejects.toBe(error)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"failedAcquireMaxMs":5000'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"databaseErrorCode":"unknown"'))
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|host|timeout exceeded/)
    await database.end()
  })

  it('preserves explicit configuration overrides and flushes an unfinished window on close', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const { database, pool } = buildDatabase('dispatcher', { max: 2, idleTimeoutMillis: 123, connectionTimeoutMillis: 456 })
    expect(pool.options).toMatchObject({ max: 2, idleTimeoutMillis: 123, connectionTimeoutMillis: 456 })
    ;(await database.connect()).release()
    ;(await database.connect()).release()
    expect(console.info).toHaveBeenCalledOnce()
    await database.end()
    expect(console.info).toHaveBeenCalledTimes(2)
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('"acquired":1'))
  })

  it('does not strand a client or mask a DB failure when the diagnostic sink throws', async () => {
    vi.spyOn(console, 'info').mockImplementationOnce(() => { throw new Error('output closed') })
    vi.spyOn(console, 'warn').mockImplementationOnce(() => { throw new Error('output closed') })
    const { database, release, connect } = buildDatabase()
    const connection = await database.connect()
    connection.release()
    expect(release).toHaveBeenCalledOnce()
    const error = Object.assign(new Error('connection failed'), { code: 'ECONNRESET' })
    connect.mockRejectedValue(error)
    await expect(database.connect()).rejects.toBe(error)
    await database.end()
  })
})
