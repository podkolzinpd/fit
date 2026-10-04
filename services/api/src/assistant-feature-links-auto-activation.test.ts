import type { QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'

import type { DatabaseConnection, DatabasePool } from './db/types.js'
import { DatabaseAssistantFeatureLinksAutoActivator } from './assistant-feature-links-auto-activation.js'

class Connection implements DatabaseConnection {
  calls: Array<{ text: string; values: readonly unknown[] }> = []
  released = false
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<readonly Row[]> {
    this.calls.push({ text, values })
    return Promise.resolve([{ bound: true }] as unknown as readonly Row[])
  }
  release() { this.released = true }
}

class Pool implements DatabasePool {
  connection = new Connection()
  connect() { return Promise.resolve(this.connection) }
  end() { return Promise.resolve() }
}

describe('assistant feature links auto activation', () => {
  it('binds only validated hashes through the database contract', async () => {
    const pool = new Pool()
    const subjectHash = 'a'.repeat(64)
    const loginHash = 'b'.repeat(64)
    await expect(new DatabaseAssistantFeatureLinksAutoActivator(pool).bind(subjectHash, loginHash))
      .resolves.toEqual({ bound: true })
    expect(pool.connection.calls[0]?.text).toContain('bind_assistant_feature_links_for_yandex_login')
    expect(pool.connection.calls[0]?.values).toEqual([subjectHash, loginHash])
    expect(pool.connection.released).toBe(true)
  })

  it('fails closed before querying for malformed hashes', async () => {
    const pool = new Pool()
    await expect(new DatabaseAssistantFeatureLinksAutoActivator(pool).bind('bad', 'hash'))
      .resolves.toEqual({ bound: false })
    expect(pool.connection.calls).toHaveLength(0)
  })
})
