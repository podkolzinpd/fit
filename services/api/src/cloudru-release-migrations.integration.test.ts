import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PG_MIGRATE_LOCK_ID } from 'node-pg-migrate'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateCloudruRelease } from './cloudru-release-migrations.js'

const database = `fit_release_test_${process.pid}`
const restoredDatabase = `${database}_restore`
const source = process.env.TEST_DATABASE_URL
const baseline = '000001_baseline'

describe.skipIf(source === undefined)('Cloud.ru forward release migrations on local PostgreSQL', () => {
  let admin: Client
  let client: Client
  let peer: Client
  let created = false
  let restoredCreated = false
  let directory: string
  let owner: string
  let backup = vi.fn<() => Promise<void>>()

  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('local_test_database_required')
    owner = decodeURIComponent(url.username)
    admin = new Client({ connectionString: url.href })
    await admin.connect()
    await admin.query(`create database ${database}`)
    created = true
    url.pathname = `/${database}`
    client = new Client({ connectionString: url.href })
    peer = new Client({ connectionString: url.href })
    await client.connect()
    await peer.connect()
  })

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fit-release-migration-test-'))
    await writeFile(join(directory, `${baseline}.sql`), '-- Up Migration\nselect 1;\n-- Down Migration\nselect 1;')
    await client.query(`drop schema if exists app_private cascade;
      drop schema public cascade; create schema public; create schema app_private;
      create table app_private.fit_migrations(id serial primary key, name varchar(255) not null, run_on timestamp not null);
      create table public.release_fixture(id integer primary key, value integer);
      insert into public.release_fixture values (1, 5)`)
    await client.query('insert into app_private.fit_migrations(name, run_on) values ($1, now())', [baseline])
    backup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  afterAll(async () => {
    if (client) await client.end()
    if (peer) await peer.end()
    if (created) await admin.query(`drop database ${database}`)
    if (restoredCreated) await admin.query(`drop database ${restoredDatabase}`)
    if (admin) await admin.end()
  })

  const release = () => migrateCloudruRelease({ client, expectedDatabase: database, expectedOwner: owner, directory, backup })
  const pending = async (sql = 'create table public.added_fixture(id integer primary key);') => {
    await writeFile(join(directory, '000002_pending.sql'), `-- Up Migration\n${sql}\n-- Down Migration\ndrop table public.added_fixture;`)
  }
  const assertUntouched = async () => {
    expect((await client.query<{ relation: string | null }>("select to_regclass('public.added_fixture')::text as relation")).rows[0]?.relation)
      .toBeNull()
    expect((await client.query<{ name: string }>('select name from app_private.fit_migrations order by id')).rows)
      .toEqual([{ name: baseline }])
    expect((await client.query<{ value: number }>('select value from public.release_fixture')).rows).toEqual([{ value: 5 }])
  }

  it('backs up before applying, retains the standard lock across backup, verifies history and becomes a no-op on retry', async () => {
    await pending()
    backup.mockImplementation(async () => {
      await assertUntouched()
      expect((await peer.query<{ acquired: boolean }>('select pg_try_advisory_lock($1::bigint) as acquired', [String(PG_MIGRATE_LOCK_ID)])).rows[0]?.acquired)
        .toBe(false)
    })
    expect(await release()).toBe(1)
    expect(backup).toHaveBeenCalledOnce()
    expect((await client.query<{ name: string }>('select name from app_private.fit_migrations order by id')).rows)
      .toEqual([{ name: baseline }, { name: '000002_pending' }])
    expect(await release()).toBe(0)
    expect(backup).toHaveBeenCalledOnce()
    expect((await peer.query<{ acquired: boolean }>('select pg_try_advisory_lock($1::bigint) as acquired', [String(PG_MIGRATE_LOCK_ID)])).rows[0]?.acquired)
      .toBe(true)
    await peer.query('select pg_advisory_unlock($1::bigint)', [String(PG_MIGRATE_LOCK_ID)])
  })

  it('rolls back all pending DDL and history when a later SQL statement fails', async () => {
    await pending()
    await writeFile(join(directory, '000003_failure.sql'), '-- Up Migration\nselect 1 / 0;\n-- Down Migration\nselect 1;')
    await expect(release()).rejects.toThrow()
    expect(backup).toHaveBeenCalledOnce()
    await assertUntouched()
  })

  it('does not apply any pending SQL when the backup fails', async () => {
    await pending()
    backup.mockRejectedValue(new Error('synthetic_backup_failure'))
    await expect(release()).rejects.toThrow('synthetic_backup_failure')
    await assertUntouched()
  })

  it('fails promptly on another migrator without releasing its lock', async () => {
    await pending()
    await peer.query('select pg_advisory_lock($1::bigint)', [String(PG_MIGRATE_LOCK_ID)])
    try {
      await expect(release()).rejects.toThrow('cloudru_migration_locked')
      expect(backup).not.toHaveBeenCalled()
      await assertUntouched()
    } finally {
      expect((await peer.query<{ released: boolean }>('select pg_advisory_unlock($1::bigint) as released', [String(PG_MIGRATE_LOCK_ID)])).rows[0]?.released)
        .toBe(true)
    }
  })

  it('rejects missing or empty history rather than bootstrapping the target', async () => {
    await client.query('truncate app_private.fit_migrations')
    await expect(release()).rejects.toThrow('cloudru_migration_history_rejected')
    await client.query('drop table app_private.fit_migrations')
    await expect(release()).rejects.toThrow('cloudru_migration_identity_rejected')
    expect((await client.query<{ relation: string | null }>("select to_regclass('app_private.fit_migrations')::text as relation")).rows[0]?.relation)
      .toBeNull()
    expect(backup).not.toHaveBeenCalled()
  })

  it('refuses history from a newer or different image and does not silently add a missing primary key', async () => {
    await client.query("insert into app_private.fit_migrations(name, run_on) values ('000999_unknown', now())")
    await expect(release()).rejects.toThrow('cloudru_migration_history_rejected')
    await client.query('alter table app_private.fit_migrations drop constraint fit_migrations_pkey')
    await expect(release()).rejects.toThrow('cloudru_migration_history_rejected')
    expect(backup).not.toHaveBeenCalled()
  })

  it('rejects explicit transaction boundaries before backup or apply', async () => {
    await pending('create table public.added_fixture(id integer);\nCOMMIT;')
    await expect(release()).rejects.toThrow('cloudru_migration_transaction_rejected')
    expect(backup).not.toHaveBeenCalled()
    await assertUntouched()
  })

  it('rejects a mismatched owner instead of applying through the runtime identity', async () => {
    await expect(migrateCloudruRelease({ client, expectedDatabase: database, expectedOwner: 'fit_api', directory, backup }))
      .rejects.toThrow('cloudru_migration_identity_rejected')
    expect(backup).not.toHaveBeenCalled()
  })

  it.skipIf(process.env.TEST_POSTGRES_CONTAINER === undefined)('restores a real PostgreSQL17 pre-migration archive without losing existing fixture rows', async () => {
    const engine = process.env.TEST_POSTGRES_ENGINE ?? 'podman'
    const container = process.env.TEST_POSTGRES_CONTAINER ?? ''
    if (!['podman', 'docker'].includes(engine) || !/^[a-zA-Z0-9-]+$/u.test(container)) throw new Error('local_backup_test_container_required')
    await pending()
    await admin.query(`create database ${restoredDatabase}`)
    restoredCreated = true
    backup.mockImplementation(() => {
      const dump = spawnSync(engine, ['exec', container, 'pg_dump', '-U', 'postgres', '-d', database,
        '--format=custom', '--no-owner', '--no-acl'], { timeout: 30_000 })
      expect(dump.status).toBe(0)
      const restored = spawnSync(engine, ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', restoredDatabase,
        '--no-owner', '--no-acl', '--exit-on-error'], { input: dump.stdout, timeout: 30_000 })
      expect(restored.status).toBe(0)
      return Promise.resolve()
    })
    expect(await release()).toBe(1)
    const url = new URL(source ?? '')
    url.pathname = `/${restoredDatabase}`
    const restored = new Client({ connectionString: url.href })
    await restored.connect()
    try {
      expect((await restored.query<{ value: number }>('select value from public.release_fixture')).rows).toEqual([{ value: 5 }])
      expect((await restored.query<{ relation: string | null }>("select to_regclass('public.added_fixture')::text as relation")).rows[0]?.relation)
        .toBeNull()
    } finally {
      await restored.end()
    }
  })
})
