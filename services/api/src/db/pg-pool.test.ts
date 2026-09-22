import { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PgDatabasePool } from './pg-pool.js'

afterEach(() => vi.restoreAllMocks())

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
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledWith(JSON.stringify({
        level: 'WARN',
        event: 'database_pool_idle_error',
        databaseErrorCategory: 'network',
        databaseErrorCode: 'ECONNRESET',
      }))
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private|host/)
    } finally {
      await database.end()
    }
  })
})
