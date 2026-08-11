import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'
import { Pool, type QueryResultRow } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withActorTransaction } from './actor-transaction.js'
import { PgDatabasePool } from './pg-pool.js'
import type { DatabasePool } from './types.js'

const ACTOR_ID = 'c9f75482-117d-4532-8f67-6c3d9b9f4a5e'
const RUNTIME_PASSWORD = 'fit-api-test-only'
const migrationsDirectory = fileURLToPath(
  new URL('../../db/migrations', import.meta.url),
)

interface ActorRow extends QueryResultRow {
  actor_id: string | null
}

function requireLocalTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required')

  const url = new URL(value)
  const isLocalHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (!isLocalHost || url.pathname !== '/fit_actor_test') {
    throw new Error(
      'Integration tests require a local database named fit_actor_test',
    )
  }
  return value
}

async function readActor(pool: DatabasePool): Promise<string | null> {
  const connection = await pool.connect()
  try {
    const rows = await connection.query<ActorRow>(
      'select auth.uid() as actor_id',
    )
    return rows[0]?.actor_id ?? null
  } finally {
    connection.release()
  }
}

describe.skipIf(process.env.TEST_DATABASE_URL === undefined)(
  'actor context PostgreSQL baseline',
  () => {
    let ownerPool: Pool | undefined
    let runtimePool: PgDatabasePool | undefined

    beforeAll(async () => {
      const ownerUrl = requireLocalTestDatabaseUrl()
      ownerPool = new Pool({ connectionString: ownerUrl, max: 1 })
      await ownerPool.query(`
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = 'fit_api') then
            create role fit_api login password '${RUNTIME_PASSWORD}';
          else
            alter role fit_api login password '${RUNTIME_PASSWORD}';
          end if;
        end
        $$;
      `)

      await runner({
        databaseUrl: ownerUrl,
        dir: migrationsDirectory,
        direction: 'up',
        migrationsTable: 'fit_migrations',
        migrationsSchema: 'app_private',
        createMigrationsSchema: true,
        verbose: false,
      })

      const runtimeUrl = new URL(ownerUrl)
      runtimeUrl.username = 'fit_api'
      runtimeUrl.password = RUNTIME_PASSWORD
      runtimePool = new PgDatabasePool({
        connectionString: runtimeUrl.toString(),
        max: 1,
      })
    })

    afterAll(async () => {
      await runtimePool?.end()
      await ownerPool?.end()
    })

    it('exposes the internal UUID through auth.uid only in one transaction', async () => {
      if (runtimePool === undefined) throw new Error('Runtime pool is not ready')

      expect(await readActor(runtimePool)).toBeNull()

      const actorInsideTransaction = await withActorTransaction(
        runtimePool,
        ACTOR_ID,
        async (client) => {
          const rows = await client.query<ActorRow>(
            'select auth.uid() as actor_id',
          )
          return rows[0]?.actor_id ?? null
        },
      )

      expect(actorInsideTransaction).toBe(ACTOR_ID)
      expect(await readActor(runtimePool)).toBeNull()
    })
  },
)
