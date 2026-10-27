import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool, type QueryResultRow } from 'pg'
import { runner } from 'node-pg-migrate'
import { CorporateAdminStore } from '../corporate-admin.js'
import { PgDatabasePool } from './pg-pool.js'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const source = process.env.TEST_DATABASE_URL
const database = `fit_corporate_admin_${process.pid}`
const directory = fileURLToPath(new URL('../../db/migrations', import.meta.url))

describe.skipIf(!source)('corporate administration on real actor/RLS', () => {
  let owner: Pool, pool: Pool
  let created = false
  let connectionString = ''
  const card = randomUUID(), workout = randomUUID()
  const admin = randomUUID(), coach = randomUUID(), athlete = randomUUID(), officeId = randomUUID()
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw new Error('local_fit_actor_test_database_required')
    owner = new Pool({ connectionString: url.href })
    await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1);
      if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if; end $$`)
    await owner.query(`create database ${database}`); created = true
    url.pathname = `/${database}`
    await runner({ databaseUrl: url.href, dir: directory, direction: 'up', migrationsTable: 'fit_migrations',
      migrationsSchema: 'app_private', createMigrationsSchema: true, verbose: false, log: () => {} })
    connectionString = url.href
    pool = new Pool({ connectionString, max: 4 })
    await pool.query(`insert into public.profiles(id,first_name,account_role) values($1,'Synthetic admin','client'),($2,'Synthetic coach','trainer'),($3,'Synthetic athlete','client')`,[admin,coach,athlete])
    await pool.query('insert into public.trainers(profile_id) values($1)',[coach])
    await pool.query(`insert into public.clients(id,trainer_id,full_name) values($1,$2,'Synthetic client')`,[card,coach])
    await pool.query(`insert into public.workouts(id,client_id,trainer_id,created_by,workout_date,status,completed_at,training_format) values($1,$2,$3,$3,current_date,'done',now(),'with_trainer')`,[workout,card,coach])
    await pool.query('insert into app_private.corporate_admins(profile_id) values($1)',[admin])
  }, 90_000)
  afterAll(async () => { if (pool) await pool.end(); if (created) await owner.query(`drop database ${database}`); if(owner) await owner.end() })
  async function actor<Row extends QueryResultRow = QueryResultRow>(id: string, sql: string, args: unknown[] = []) {
    const c = await pool.connect()
    try {
      await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]); await c.query('set local role fit_api')
      const result = await c.query<Row>(sql,args); await c.query('commit'); return result.rows
    } catch(e) { await c.query('rollback'); throw e } finally { c.release() }
  }
  const saveOffice = (id: string, version: number, archived=false, name='Бенуа') => actor(admin,
    'select app_private.save_corporate_office($1,$2,$3,$4,$5,$6)',[id,'Санкт-Петербург',name,'Синтетический адрес',archived,version])
  const saveTrainer = (enabled: boolean, offices: string[], version: number) => actor(admin,
    'select app_private.save_corporate_trainer($1,$2,$3::uuid[],$4)',[coach,enabled,offices,version])

  it('does not grant admin by account role and denies direct reads, writes and self-elevation', async () => {
    for(const id of [coach,athlete]) {
      expect(await actor(id,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
      await expect(actor(id,'select app_private.corporate_admin_bundle()')).rejects.toMatchObject({code:'PT403'})
      await expect(actor(id,'select app_private.save_corporate_office($1,\'a\',\'b\',\'c\',false,0)',[officeId])).rejects.toMatchObject({code:'PT403'})
      await expect(actor(id,'select app_private.save_corporate_trainer($1,true,$2::uuid[],0)',[coach,[officeId]])).rejects.toMatchObject({code:'PT403'})
      await expect(actor(id,'insert into app_private.corporate_admins(profile_id) values($1)',[id])).rejects.toMatchObject({code:'42501'})
      await expect(actor(id,'select id from public.corporate_offices')).rejects.toMatchObject({code:'42501'})
    }
  })
  it('creates an office once, rejects duplicates and protects optimistic updates', async () => {
    await saveOffice(officeId,0); await saveOffice(officeId,0)
    expect((await pool.query('select id from public.corporate_offices')).rowCount).toBe(1)
    expect((await pool.query('select id from app_private.corporate_admin_audit')).rowCount).toBe(1)
    await expect(saveOffice(randomUUID(),0)).rejects.toMatchObject({code:'PT422',message:'corporate_office_duplicate'})
    await expect(saveOffice(officeId,0,false,'Другой')).rejects.toMatchObject({code:'PT409'})
  })
  it('requires active offices and an actual trainer, and allows multiple offices', async () => {
    await expect(saveTrainer(true,[],0)).rejects.toMatchObject({code:'PT422'})
    await expect(saveTrainer(true,[randomUUID()],0)).rejects.toMatchObject({code:'PT422'})
    await expect(actor(admin,'select app_private.save_corporate_trainer($1,true,$2::uuid[],0)',[athlete,[officeId]])).rejects.toMatchObject({code:'PT404'})
    const second=randomUUID(); await saveOffice(second,0,false,'Второй офис')
    await saveTrainer(true,[officeId,second],0); await saveTrainer(true,[officeId,second],0)
    expect((await pool.query('select office_id from public.corporate_trainer_offices')).rowCount).toBe(2)
    await expect(saveTrainer(false,[],0)).rejects.toMatchObject({code:'PT409'})
    await saveOffice(second,1,true,'Второй офис')
    await expect(saveOffice(officeId,1,true)).rejects.toMatchObject({code:'PT422',message:'corporate_office_in_use'})
    await saveTrainer(false,[],1); await saveOffice(officeId,1,true)
    await expect(saveTrainer(true,[officeId],2)).rejects.toMatchObject({code:'PT422'})
    await saveOffice(officeId,2,false); await saveTrainer(true,[officeId],2)
  })
  it('does not alter roles, business records, memberships or existing tenant visibility', async () => {
    expect((await pool.query('select account_role from public.profiles where id=$1',[admin])).rows).toEqual([{account_role:'client'}])
    for(const table of ['client_trainers','client_trainer_relationships','trainer_finance_sessions']) {
      expect((await pool.query(`select count(*)::int n from public.${table}`)).rows).toEqual([{n:0}])
    }
    expect((await pool.query('select id,client_id,trainer_id,status,training_format from public.workouts where id=$1',[workout])).rows).toEqual([{id:workout,client_id:card,trainer_id:coach,status:'done',training_format:'with_trainer'}])
    const rows=await actor<{bundle:{offices:unknown[];trainers:Array<{id:string;isYandex:boolean}>}}>(admin,'select app_private.corporate_admin_bundle() bundle')
    expect(rows[0]?.bundle.trainers).toContainEqual(expect.objectContaining({id:coach,isYandex:true}))
    const policies=await pool.query("select policyname from pg_policies where tablename in ('workouts','clients') and qual like '%corporate%'")
    expect(policies.rowCount).toBe(0)
  })
  it('resolves the same real app session without widening workout visibility', async () => {
    const token='a'.repeat(43), otherToken='b'.repeat(43)
    for(const [raw,id] of [[token,admin],[otherToken,coach]] as const) {
      await pool.query(`insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled)
        values($1,'yandex','read_write',true) on conflict(profile_id) do update set enabled=true`,[id])
      await pool.query(`insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '1 hour')`,[createHash('sha256').update(raw).digest('hex'),id])
    }
    const runtime = new PgDatabasePool({connectionString,max:1})
    try {
      const store=new CorporateAdminStore(runtime)
      expect(await store.access({accessMode:'read_write',token})).toEqual({allowed:true})
      expect(await store.access({accessMode:'read_write',token:otherToken})).toEqual({allowed:false})
      await expect(store.bundle({accessMode:'read_write',token:otherToken})).rejects.toMatchObject({code:'PT403'})
      expect(await store.bundle({accessMode:'read_write',token})).toHaveProperty('trainers')
      expect(await actor(admin,'select id from public.workouts where id=$1',[workout])).toEqual([])
      expect(await actor(coach,'select id from public.workouts where id=$1',[workout])).toEqual([{id:workout}])
    } finally {await runtime.end()}
  })
  it('revokes an existing admin immediately and protects its audit', async () => {
    await expect(actor(admin,'delete from app_private.corporate_admin_audit')).rejects.toMatchObject({code:'42501'})
    await pool.query('update app_private.corporate_admins set enabled=false where profile_id=$1',[admin])
    await expect(actor(admin,'select app_private.corporate_admin_bundle()')).rejects.toMatchObject({code:'PT403'})
  })
  it('grants only the owner-approved login after verified binding, before or after account creation', async () => {
    const login='c'.repeat(64), subject='d'.repeat(64)
    await pool.query('insert into app_private.corporate_admin_logins(login_sha256) values($1)',[login])
    expect(await actor(athlete,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
    expect(await actor(athlete,'select app_private.bind_corporate_admin_login($1,$2) bound',[subject,'e'.repeat(64)])).toEqual([{bound:false}])
    expect(await actor(athlete,'select app_private.bind_corporate_admin_login($1,$2) bound',[subject,login])).toEqual([{bound:true}])
    // A verified subject alone does not grant access to an unrelated current session.
    expect(await actor(athlete,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
    await pool.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2)",[subject,athlete])
    expect(await actor(athlete,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:true}])
    expect(await actor(coach,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
    expect(await actor(athlete,'select app_private.bind_corporate_admin_login($1,$2) bound',['f'.repeat(64),login])).toEqual([{bound:false}])
    await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256) values($1)',['e'.repeat(64)])).rejects.toMatchObject({code:'23505'})
    await expect(actor(coach,'update app_private.corporate_admin_logins set enabled=true')).rejects.toMatchObject({code:'42501'})
    await pool.query('update app_private.corporate_admin_logins set enabled=false where login_sha256=$1',[login])
    expect(await actor(athlete,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
    expect((await pool.query('select account_role from public.profiles where id=$1',[athlete])).rows).toEqual([{account_role:'client'}])
  })
  it('reverses and reapplies only the new migration without changing workouts', async () => {
    const url=new URL(source ?? ''); url.pathname=`/${database}`
    const options={ databaseUrl:url.href,dir:directory,migrationsTable:'fit_migrations',migrationsSchema:'app_private',verbose:false,log:()=>{} }
    await runner({...options,direction:'down',count:2})
    expect((await pool.query("select to_regclass('public.corporate_offices') present")).rows).toEqual([{present:null}])
    expect((await pool.query('select status from public.workouts where id=$1',[workout])).rows).toEqual([{status:'done'}])
    await runner({...options,direction:'up'})
    expect(await actor(coach,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
  })
})
