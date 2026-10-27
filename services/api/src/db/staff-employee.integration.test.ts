import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const source = process.env.TEST_DATABASE_URL
const name = `fit_staff_${process.pid}`
const directory = fileURLToPath(new URL('../../db/migrations', import.meta.url))
describe.skipIf(source === undefined)('Staff employee evidence with real PostgreSQL/RLS', () => {
  let admin: Pool, db: Pool
  let created = false
  let databaseUrl: string
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw new Error('local_fit_actor_test_database_required')
    admin = new Pool({ connectionString: url.href })
    await admin.query(`do $$ begin
      perform pg_advisory_xact_lock(193635,1);
      if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if;
    end $$`)
    await admin.query(`create database ${name}`)
    created = true
    url.pathname = '/' + name
    databaseUrl = url.href
    await runner({ databaseUrl, dir: directory, direction: 'up', migrationsTable: 'fit_migrations',
      migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} })
    db = new Pool({ connectionString: databaseUrl })
  }, 60000)
  afterAll(async () => {
    if (db) await db.end()
    if (created) await admin.query(`drop database ${name}`)
    if (admin) await admin.end()
  })
  const first = randomUUID(), second = randomUUID()
  const a = 'a'.repeat(64), b = 'b'.repeat(64)
  async function own(actor: string) {
    const client = await db.connect()
    try {
      await client.query('begin')
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor])
      await client.query('set local role fit_api')
      return (await client.query<{ value: unknown }>('select app_private.own_yandex_employee_verification() value')).rows[0]?.value
    } finally { await client.query('rollback'); client.release() }
  }
  it('keeps pre-registration evidence and reads only the current actor, without directory table access', async () => {
    await db.query('select app_private.record_yandex_employee_verification($1,true,now())', [a])
    await db.query("insert into public.profiles(id,first_name,account_role) values($1,'Synthetic one','client'),($2,'Synthetic two','client')", [first, second])
    await db.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2),('yandex',$3,$4)", [a,first,b,second])
    expect(await own(first)).toMatchObject({ status: 'employee' })
    expect(await own(second)).toEqual({ status: 'unknown', checkedAt: null })
    const c = await db.connect()
    try {
      await c.query('set role fit_api')
      await expect(c.query('select * from app_private.yandex_employee_verifications')).rejects.toMatchObject({ code: '42501' })
    } finally { await c.query('reset role');c.release() }
  })
  it('does not overwrite a newer negative check with a delayed positive result', async () => {
    await db.query("select app_private.record_yandex_employee_verification($1,false,now()), app_private.record_yandex_employee_verification($1,true,now()-interval '1 hour')", [b])
    expect(await own(second)).toMatchObject({ status: 'not_employee' })
  })
  it('marks stale evidence unknown without rewriting it as non-employee', async () => {
    await db.query("update app_private.yandex_employee_verifications set checked_at=now()-interval '2 days' where subject_sha256=$1", [a])
    expect(await own(first)).toMatchObject({ status: 'unknown' })
    expect((await db.query('select is_employee from app_private.yandex_employee_verifications where subject_sha256=$1', [a])).rows).toEqual([{ is_employee: true }])
  })
  it('rejects malformed evidence and supports rolling the new migration down and up', async () => {
    await expect(db.query('select app_private.record_yandex_employee_verification($1,true,now())',['bad'])).rejects.toMatchObject({ code: 'PT422' })
    await runner({ databaseUrl, dir: directory, direction: 'down', count: 1, migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', verbose: false, log: () => {} })
    await runner({ databaseUrl, dir: directory, direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', verbose: false, log: () => {} })
    expect(await own(first)).toEqual({ status: 'unknown', checkedAt: null })
  }, 60000)
})
