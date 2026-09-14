import { describe, expect, it, vi } from 'vitest'

import type { DatabaseClient, DatabasePool } from '../db/types.js'
import { buildMigrationTable, encryptMigrationBundle, fingerprintFullCohort } from './bundle.js'
import { DatabaseStageTenantMigrationRunner } from './stage-runner.js'
import type { FullCohortMigrationBundle } from './types.js'

const PASSPHRASE = 'stage-runner-test-passphrase'

function buildPool(): { pool: DatabasePool; connect: ReturnType<typeof vi.fn> } {
  const connection: DatabaseClient & { release: () => void } = {
    query: vi.fn().mockResolvedValue([]) as DatabaseClient['query'],
    release: vi.fn(),
  }
  const connect = vi.fn().mockResolvedValue(connection)
  return {
    connect,
    pool: { connect, end: vi.fn().mockResolvedValue(undefined) },
  }
}

async function buildEnvelope(): Promise<unknown> {
  const tables = [buildMigrationTable('public.chat_messages', [{
    id: 'message',
    image_path: 'conversation/message.jpg',
    image_size_bytes: 3,
  }])]
  const bundle: FullCohortMigrationBundle = {
    createdAt: '2026-09-14T00:00:00.000Z',
    format: 'fit-full-cohort-bundle-v1',
    tables,
    tenantFingerprint: fingerprintFullCohort(tables),
  }
  return encryptMigrationBundle(bundle, PASSPHRASE)
}

describe('DatabaseStageTenantMigrationRunner media gate', () => {
  it('rejects referenced media before opening a database connection when storage is absent', async () => {
    const { connect, pool } = buildPool()
    const runner = new DatabaseStageTenantMigrationRunner(pool)

    await expect(runner.run(await buildEnvelope(), PASSPHRASE, false))
      .rejects.toThrow('tenant_media_storage_not_configured')
    expect(connect).not.toHaveBeenCalled()
  })

  it('verifies referenced media before opening a database connection', async () => {
    const { connect, pool } = buildPool()
    const verify = vi.fn().mockRejectedValue(new Error('media rejected'))
    const runner = new DatabaseStageTenantMigrationRunner(pool, { verify })
    const envelope = await buildEnvelope()

    await expect(runner.run(envelope, PASSPHRASE, false))
      .rejects.toThrow('media rejected')
    expect(verify).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
  })
})
