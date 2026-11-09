import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { runner } from 'node-pg-migrate'
import { CorporateInvitationsStore } from '../corporate-invitations.js'
import { CorporateAdminStore } from '../corporate-admin.js'
import { PrivateAnalyticsStore } from '../private-analytics.js'
import { PgDatabasePool } from './pg-pool.js'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const source = process.env.TEST_DATABASE_URL
const database = `fit_corporate_admin_${process.pid}`
const directory = fileURLToPath(new URL('../../db/migrations', import.meta.url))

describe.skipIf(!source)('corporate administration on real actor/RLS', () => {
  let owner: Pool, pool: Pool
  let created = false
  let connectionString = ''
  let financeBeforeAdmin: Array<{ row: Record<string, unknown> }> = []
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
    financeBeforeAdmin = (await pool.query<{ row: Record<string, unknown> }>(
      'select to_jsonb(session) row from public.trainer_finance_sessions session order by session.id')).rows
    expect(financeBeforeAdmin).toHaveLength(1)
    expect(financeBeforeAdmin).toMatchObject([{ row: { workout_id: workout, client_id: card, trainer_id: coach,
      disposition: 'unassigned', package_id: null, source: 'automatic' } }])
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

  it('keeps private analytics separate, binds once, and enforces revocation', async () => {
    const profile = randomUUID(), subject = 'a'.repeat(64), otherSubject = 'b'.repeat(64), login = 'c'.repeat(64)
    await pool.query("insert into public.profiles(id,first_name,account_role) values($1,'Analytics test','client')", [profile])
    await pool.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2)", [subject, profile])
    await expect(actor(admin, 'select app_private.private_analytics_bundle()')).rejects.toMatchObject({ code: 'PT403' })
    await expect(actor(profile, 'select * from app_private.private_analytics_logins')).rejects.toMatchObject({ code: '42501' })
    await pool.query('insert into app_private.private_analytics_logins(login_sha256,enabled) values($1,true)', [login])
    expect(await actor(profile, 'select app_private.bind_private_analytics_login($1,$2) bound', [subject, login])).toEqual([{ bound: true }])
    expect(await actor(profile, 'select app_private.bind_private_analytics_login($1,$2) bound', [otherSubject, login])).toEqual([{ bound: false }])
    const rows = await actor<{ bundle: { trainers: unknown[]; clients: unknown[]; feedback: unknown[] } }>(profile, 'select app_private.private_analytics_bundle() bundle')
    expect(rows[0]?.bundle.trainers).toHaveLength(1)
    expect(Array.isArray(rows[0]?.bundle.clients)).toBe(true)
    expect(Array.isArray(rows[0]?.bundle.feedback)).toBe(true)
    const filters={from:'2020-01-01',to:'2020-01-02',section:'people',pageSize:1,sort:'name',direction:'asc'}
    const explore=(patch:Record<string,unknown>={})=>actor<{result:{rows:Array<Record<string,unknown>>;total:number;summary:Record<string,number>;trend:unknown[]}}>(profile,'select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,...patch})])
    const today=(await pool.query<{day:string}>("select (now() at time zone 'Europe/Moscow')::date::text as day")).rows[0]!.day
    const futureDay=new Date(Date.parse(`${today}T12:00:00Z`)+60*86400000).toISOString().slice(0,10)
    expect((await actor<{measured:boolean}>(profile,"select (app_private.private_analytics_explore($1::jsonb)->>'retentionMeasured')::boolean measured",[JSON.stringify({...filters,from:futureDay,to:futureDay})]))[0]?.measured).toBe(false)
    expect((await explore())[0]?.result.total).toBeGreaterThan(1)
    expect((await explore())[0]?.result.rows).toHaveLength(1)
    expect((await explore({page:2}))[0]?.result.rows[0]?.id).not.toEqual((await explore())[0]?.result.rows[0]?.id)
    expect((await explore({section:'workouts',from:today,to:today,status:'done'}))[0]?.result.rows[0]).toMatchObject({id:workout,status:'done',person:'Synthetic client'})
    expect((await explore({section:'workouts',from:today,to:today,status:'cancelled'}))[0]?.result.total).toBe(0)
    expect((await explore({section:'people',search:'no such synthetic name'}))[0]?.result.total).toBe(0)
    await expect(actor(admin,'select app_private.private_analytics_explore($1::jsonb)',[JSON.stringify(filters)])).rejects.toMatchObject({code:'PT403'})
    for(const table of ['analytics_actions','analytics_activity','analytics_people','analytics_records']) await expect(actor(profile,`select * from app_private.${table}`)).rejects.toMatchObject({code:'42501'})
    await expect(explore({from:'2026-11-07',to:'2026-11-01'})).rejects.toMatchObject({code:'PT422'})
    // Authoritative acting actor, not the trainer_id owner. Service timestamps
    // alone do not add activity; writes roll back with their business transaction.
    const db=await pool.connect()
    try {
      await db.query('begin')
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[athlete])
      await db.query('update public.workouts set notes=$2 where id=$1',[workout,'Synthetic change'])
      const events=await db.query('select actor_id,feature from app_private.analytics_actions where entity_id=$1',[workout])
      expect(events.rows).toEqual([{actor_id:athlete,feature:'workouts'}])
      await db.query('update public.workouts set version=version+1 where id=$1',[workout])
      expect((await db.query<{n:number}>('select count(*)::int n from app_private.analytics_actions where entity_id=$1',[workout])).rows[0]!.n).toBe(1)
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[profile])
      const active=await db.query<{result:{rows:Array<Record<string,unknown>>;summary:Record<string,number>;total:number}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'activities',pageSize:50})])
      expect(active.rows[0]!.result.rows).toContainEqual(expect.objectContaining({person_id:athlete,feature:'workouts',action:'updated'}))
      expect(active.rows[0]!.result.summary.active).toBe(1)
      const exerciseId=randomUUID(),setId=randomUUID()
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[athlete])
      await db.query(`insert into public.workout_exercises(id,workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind)
        values($1,$2,$3,$4,0,'system','squat','Synthetic squat','legs','strength')`,[exerciseId,workout,coach,card])
      await db.query(`insert into public.workout_sets(id,workout_exercise_id,trainer_id,client_id,position,plan_reps,fact_reps,confirmed_at)
        values($1,$2,$3,$4,0,12,10,now())`,[setId,exerciseId,coach,card])
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[profile])
      const details=(await db.query<{result:{rows:Array<Record<string,unknown>>}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'sets',workout,person:coach})])).rows[0]!.result
      expect(details.rows).toEqual([expect.objectContaining({id:setId,plan_reps:12,fact_reps:10,position:1})])
      const ranking=(await db.query<{result:{rows:Array<Record<string,unknown>>}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'exercises',role:'trainer'})])).rows[0]!.result
      expect(ranking.rows).toContainEqual(expect.objectContaining({workouts:1,users:1,sets:1}))
      const packageId=randomUUID(),paymentId=randomUUID()
      await db.query(`insert into public.trainer_finance_packages(id,trainer_id,client_id,title,sessions_total,price_cents,starts_on,payment_due_on) values($1,$2,$3,'Synthetic package',10,100000,current_date,current_date-1)`,[packageId,coach,card])
      await db.query(`insert into public.trainer_finance_payments(id,package_id,trainer_id,client_id,amount_cents,received_on) values($1,$2,$3,$4,20000,current_date)`,[paymentId,packageId,coach,card])
      const finance=(await db.query<{result:{rows:Array<Record<string,unknown>>;summary:Record<string,number>;total:number}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'payments'})])).rows[0]!.result
      expect(finance.summary).toMatchObject({received:200,due:800,overdue:800})
      expect(finance.rows[0]).toMatchObject({amount:200,id:paymentId})
      const clientFinance=(await db.query<{result:{rows:Array<Record<string,unknown>>}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'payments',person:`card:${card}`})])).rows[0]!.result
      expect(clientFinance.rows).toContainEqual(expect.objectContaining({id:paymentId,amount:200}))
      await db.query("update public.trainer_finance_payments set voided_at=now(),void_reason='Synthetic void' where id=$1",[paymentId])
      const voided=(await db.query<{result:{rows:Array<Record<string,unknown>>;summary:Record<string,number>;total:number}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'payments'})])).rows[0]!.result
      expect(voided.summary).toMatchObject({received:0,due:1000,overdue:1000});expect(voided.total).toBe(0)
      await db.query(`insert into app_private.analytics_actions(actor_id,feature,action,entity_id,occurred_at)
        select $1::uuid,'goals','created','synthetic-'||n,'2020-01-01T21:15:00Z'::timestamptz from generate_series(1,12) n
        union all select $2::uuid,'goals','created','synthetic-'||n,'2020-01-01T20:15:00Z'::timestamptz from generate_series(1,2) n`,[coach,athlete])
      const sorted=(await db.query<{result:{rows:Array<Record<string,unknown>>;trend:Array<{date:string;actions:number}>}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,pageSize:50,sort:'actions',direction:'desc',group:'day'})])).rows[0]!.result
      expect(sorted.rows.slice(0,2).map(r=>r.actions)).toEqual([12,2])
      expect(sorted.trend).toEqual([expect.objectContaining({date:'2020-01-01',actions:2}),expect.objectContaining({date:'2020-01-02',actions:12})])
      // Product-owner analytics does not inherit trainer diary consent rules.
      const mealId=randomUUID()
      await db.query(`insert into public.nutrition_entries(id,owner_id,day,meal,name,basis,grams,calories)
        values($1,$2,current_date,'lunch','Synthetic meal','100g',150,200)`,[mealId,athlete])
      const nutrition=(await db.query<{result:{rows:Array<Record<string,unknown>>}}>('select app_private.private_analytics_explore($1::jsonb) result',[JSON.stringify({...filters,from:today,to:today,section:'nutrition',person:athlete})])).rows[0]!.result
      expect(nutrition.rows).toContainEqual(expect.objectContaining({id:mealId,calories:300}))
      await db.query('update public.clients set auth_user_id=$2 where id=$1',[card,athlete])
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[coach])
      await db.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',[card,coach,athlete])
      await db.query('savepoint denied_view')
      await expect(db.query('select app_private.record_nutrition_view($1)',[card])).rejects.toMatchObject({code:'PT403'})
      await db.query('rollback to savepoint denied_view')
      await db.query(`insert into public.nutrition_consents(owner_id,client_id,trainer_id,connection_started_at,granted)
        select $1,$2,$3,joined_at,true from public.list_accessible_client_trainers() where client_id=$2 and trainer_id=$3`,[athlete,card,coach])
      await db.query('select app_private.record_nutrition_view($1)',[card])
      await db.query('select app_private.record_nutrition_view($1)',[card])
      expect((await db.query<{n:number}>("select count(*)::int n from app_private.analytics_actions where actor_id=$1 and feature='nutrition_views'",[coach])).rows[0]!.n).toBe(1)

    } finally {await db.query('rollback');db.release()}
    const token = 'p'.repeat(43)
    await pool.query("insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled) values($1,'yandex','read_write',true)", [profile])
    await pool.query("insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at) values($1,$2,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), profile])
    const runtime = new PgDatabasePool({ connectionString, max: 1 })
    try {
      const store = new PrivateAnalyticsStore(runtime)
      expect(await store.bundle({ accessMode: 'read_write', token })).toHaveProperty('trainers')
      await pool.query('update app_private.private_analytics_logins set enabled=false where login_sha256=$1', [login])
      await expect(store.bundle({ accessMode: 'read_write', token })).rejects.toMatchObject({ code: 'PT403' })
    } finally { await runtime.end() }
    await expect(actor(profile, 'select app_private.private_analytics_bundle()')).rejects.toMatchObject({ code: 'PT403' })
  })

  it('does not grant admin by account role and denies direct reads, writes and self-elevation', async () => {
    for(const id of [coach,athlete]) {
      expect(await actor(id,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
      await expect(actor(id,'select app_private.corporate_admin_bundle()')).rejects.toMatchObject({code:'PT403'})
      await expect(actor(id,'select app_private.corporate_admin_bundle_with_identity()')).rejects.toMatchObject({code:'PT403'})
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
    for(const table of ['client_trainers','client_trainer_relationships']) {
      expect((await pool.query(`select count(*)::int n from public.${table}`)).rows).toEqual([{n:0}])
    }
    expect((await pool.query('select to_jsonb(session) row from public.trainer_finance_sessions session order by session.id')).rows).toEqual(financeBeforeAdmin)
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
      await expect(store.saveTrainer({accessMode:'read_write',token},{id:athlete,isYandex:true,officeIds:[officeId],version:0})).rejects.toMatchObject({code:'PT404'})
      const currentVersion=Number((await pool.query<{version:string}>('select version from public.corporate_trainers where trainer_id=$1',[coach])).rows[0]!.version)
      const removal={id:coach,isYandex:false,officeIds:[officeId],version:currentVersion}
      await store.saveTrainer({accessMode:'read_write',token},removal)
      await store.saveTrainer({accessMode:'read_write',token},removal)
      expect((await store.bundle({accessMode:'read_write',token})).trainers).toEqual([])
      await saveTrainer(true,[officeId],currentVersion+1)

      expect(await actor(admin,'select id from public.workouts where id=$1',[workout])).toEqual([])
      expect(await actor(coach,'select id from public.workouts where id=$1',[workout])).toEqual([{id:workout}])
    } finally {await runtime.end()}
  })
  it('exposes only published identity metadata to the administrator, never the draft', async () => {
    const published = { displayName: 'Published synthetic', photos: [{ thumbnailPath: 'synthetic/published.jpg' }], avatarDataUrl: null }
    const draft = { displayName: 'Private draft', photos: [{ thumbnailPath: 'synthetic/private.jpg' }], avatarDataUrl: 'private-avatar' }
    await pool.query(`insert into public.trainer_professional_profiles(trainer_id,draft_data,published_data)
      values($1,$2::jsonb,$3::jsonb)`, [coach, JSON.stringify(draft), JSON.stringify(published)])
    type Bundle = { trainers: Array<{ id: string; publicId: string | null; publishedName: string | null; photoPath: string | null; avatarDataUrl: string | null }> }
    const read = async () => (await actor<{ bundle: Bundle }>(admin, 'select app_private.corporate_admin_bundle_with_identity() bundle'))[0]!.bundle
    const row = (await read()).trainers.find(t => t.id === coach)!
    expect(row.publicId).toBeTruthy()
    expect(row).toMatchObject({ publishedName: 'Published synthetic', photoPath: 'synthetic/published.jpg', avatarDataUrl: null })
    expect(JSON.stringify(await read())).not.toContain('Private draft')
    await pool.query('update public.trainer_professional_profiles set published_data=null where trainer_id=$1', [coach])
    expect((await read()).trainers.find(t => t.id === coach)).toMatchObject({ publicId: null, publishedName: null, photoPath: null, avatarDataUrl: null })
    await expect(actor(coach, 'select app_private.corporate_admin_bundle_with_identity()')).rejects.toMatchObject({ code: 'PT403' })
  })
  it('keeps an old API safe across migration and rollback while the new API signs photos', async () => {
    const published = { displayName: 'Rollout public name', photos: [{ thumbnailPath: 'synthetic/rollout.jpg' }] }
    await pool.query('update public.trainer_professional_profiles set published_data=$2::jsonb where trainer_id=$1', [coach, JSON.stringify(published)])
    const url = new URL(source ?? ''); url.pathname = `/${database}`
    const options = { databaseUrl: url.href, dir: directory, migrationsTable: 'fit_migrations', migrationsSchema: 'app_private', verbose: false, log: () => {} }
    const target = await pool.query<{ id: number }>("select id from app_private.fit_migrations where name ~ '_corporate_trainer_identity$'")
    expect(target.rows).toHaveLength(1)
    const count = Number((await pool.query<{ n: number }>('select count(*)::int n from app_private.fit_migrations where id >= $1', [target.rows[0]!.id])).rows[0]!.n)
    const readLegacy = async () => (await actor<{ bundle: { trainers: Array<Record<string, unknown>> } }>(admin, 'select app_private.corporate_admin_bundle() bundle'))[0]!.bundle
    await runner({ ...options, direction: 'down', count })
    const before = await readLegacy()
    await runner({ ...options, direction: 'up' })
    expect(await readLegacy()).toEqual(before)
    const oldRow = before.trainers.find(t => t.id === coach)!
    expect(oldRow).not.toHaveProperty('photoPath')
    expect(oldRow).not.toHaveProperty('avatarDataUrl')
    const runtime = new PgDatabasePool({ connectionString, max: 1 })
    try {
      const store = new CorporateAdminStore(runtime, { sign: () => Promise.resolve('https://media.example.test/rollout.jpg') })
      const result = await store.bundle({ accessMode: 'read_write', token: 'a'.repeat(43) })
      expect(result.trainers.find(t => t.id === coach)).toMatchObject({ publishedName: 'Rollout public name', photoUrl: 'https://media.example.test/rollout.jpg' })
      expect(JSON.stringify(result)).not.toContain('synthetic/rollout.jpg')
      expect(result.trainers.find(t => t.id === coach)).not.toHaveProperty('photoPath')
    } finally { await runtime.end() }
    await pool.query('update public.trainer_professional_profiles set published_data=null where trainer_id=$1', [coach])
  })
  it('publishes active offices only for an approved trainer, with immediate removal on the next read', async () => {
    await pool.query(`update public.trainer_professional_profiles set published_data=$2::jsonb where trainer_id=$1`,
      [coach, JSON.stringify({ displayName: 'Synthetic', bio: 'Яндекс', customLocations: ['Яндекс, частный текст'] })])
    const publicId = (await pool.query<{ public_id: string }>('select public_id from public.trainer_professional_profiles where trainer_id=$1', [coach])).rows[0]!.public_id
    const read = async () => (await actor<{ offices: unknown }>('', 'select app_private.public_yandex_trainer_offices($1) offices', [publicId]))[0]!.offices
    expect(await read()).toEqual([{ city: 'Санкт-Петербург', name: 'Бенуа' }])
    const additional = randomUUID()
    await saveOffice(additional, 0, false, 'Третий офис')
    const version = Number((await pool.query<{ version: string }>('select version from public.corporate_trainers where trainer_id=$1', [coach])).rows[0]!.version)
    await saveTrainer(true, [officeId, additional], version)
    expect(await read()).toHaveLength(2)
    await saveOffice(additional, 1, true, 'Третий офис')
    expect(await read()).toEqual([{ city: 'Санкт-Петербург', name: 'Бенуа' }])
    await saveTrainer(false, [officeId], version + 1)
    expect(await read()).toBeNull()
    await saveTrainer(true, [officeId], version + 2)
    await pool.query('update public.trainer_professional_profiles set published_data=null where trainer_id=$1', [coach])
    expect(await read()).toBeNull()
    expect(await actor<{ offices: unknown }>('', 'select app_private.public_yandex_trainer_offices($1) offices', [randomUUID()])).toEqual([{ offices: null }])
    await expect(actor('', 'select id from public.corporate_offices')).rejects.toMatchObject({ code: '42501' })
  })
  it('hides unmarked trainers in both bundle generations without changing their accounts or offices', async () => {
    const outsider = randomUUID()
    await pool.query(`insert into public.profiles(id,first_name,account_role) values($1,'Unmarked synthetic','trainer')`, [outsider])
    await pool.query('insert into public.trainers(profile_id) values($1)', [outsider])
    await pool.query('insert into public.corporate_trainers(trainer_id,is_yandex) values($1,false)', [outsider])
    await pool.query('insert into public.corporate_trainer_offices(trainer_id,office_id) values($1,$2)', [outsider,officeId])
    for (const name of ['corporate_admin_bundle', 'corporate_admin_bundle_with_identity']) {
      const rows = await actor<{ bundle: { trainers: Array<{ id: string }>; offices: Array<{ id: string }> } }>(admin, `select app_private.${name}() bundle`)
      expect(rows[0]!.bundle.trainers.map(t => t.id)).toEqual([coach])
      expect(rows[0]!.bundle.offices).toContainEqual(expect.objectContaining({ id: officeId }))
    }
    expect((await pool.query('select account_role from public.profiles where id=$1',[outsider])).rows).toEqual([{ account_role:'trainer' }])
    expect((await pool.query('select office_id from public.corporate_trainer_offices where trainer_id=$1',[outsider])).rows).toEqual([{ office_id:officeId }])
  })
  it('revokes an existing admin immediately and protects its audit', async () => {
    await expect(actor(admin,'delete from app_private.corporate_admin_audit')).rejects.toMatchObject({code:'42501'})
    await pool.query('update app_private.corporate_admins set enabled=false where profile_id=$1',[admin])
    await expect(actor(admin,'select app_private.corporate_admin_bundle()')).rejects.toMatchObject({code:'PT403'})
    await expect(actor(admin,'select app_private.corporate_admin_bundle_with_identity()')).rejects.toMatchObject({code:'PT403'})
  })
  it('allows a second approved administrator without replacing the first and bounds enabled slots', async () => {
    const first='1'.repeat(64), second='2'.repeat(64), subject='3'.repeat(64)
    await pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,1),($2,2)',[first,second])
    await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,2)',['4'.repeat(64)])).rejects.toMatchObject({code:'23505'})
    await expect(actor(coach,'update app_private.corporate_admin_logins set access_slot=2')).rejects.toMatchObject({code:'42501'})
    await actor(coach,'select app_private.bind_corporate_admin_login($1,$2)',[subject,second])
    await pool.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id) values('yandex',$1,$2)",[subject,coach])
    expect(await actor(coach,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:true}])
    expect((await pool.query('select enabled from app_private.corporate_admin_logins where login_sha256=$1',[first])).rows).toEqual([{enabled:true}])
    await pool.query('delete from app_private.auth_identities where profile_id=$1',[coach])
    await pool.query('delete from app_private.corporate_admin_logins where login_sha256=any($1::text[])',[[first,second]])
  })
  it('migrates two retained administrators to five independent slots without replacing identities', async () => {
    const migration = readFileSync(new URL('../../db/migrations/000190_corporate_admin_five_slots.sql', import.meta.url), 'utf8')
    const [up, down] = migration.split('-- Down Migration')
    const hashes = ['5','6','7','8','9'].map(value => value.repeat(64))
    const subject = 'a'.repeat(64)
    const operator = await import(new URL('../../../../scripts/manage-corporate-admin-access.mjs', import.meta.url).href) as {
      manageCorporateAdminAccess(client: PoolClient, action: 'grant', hash: string | undefined, slot: number): Promise<{enabled: boolean; bound: boolean; readyProfiles: number}>
    }
    await pool.query(down!)
    await pool.query(`insert into app_private.corporate_admin_logins(login_sha256,access_slot,subject_sha256,bound_at)
      values($1,1,$3,now()),($2,2,null,null)`, [hashes[0],hashes[1],subject])
    const retained = (await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a order by access_slot')).rows
    try {
      await pool.query(up!)
      expect((await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a order by access_slot')).rows).toEqual(retained)
      for (const slot of [3,4,5]) {
        const client = await pool.connect()
        try { expect(await operator.manageCorporateAdminAccess(client,'grant',hashes[slot-1],slot)).toMatchObject({enabled:true,bound:false,readyProfiles:0}) }
        finally { client.release() }
      }
      expect((await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a where access_slot<=2 order by access_slot')).rows).toEqual(retained)
      expect((await pool.query('select count(*)::int n from app_private.corporate_admin_logins where enabled')).rows).toEqual([{n:5}])
      await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,6)', ['b'.repeat(64)])).rejects.toMatchObject({code:'23514'})
      await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,3)', ['b'.repeat(64)])).rejects.toMatchObject({code:'23505'})
      await expect(actor(coach,'update app_private.corporate_admin_logins set enabled=false')).rejects.toMatchObject({code:'42501'})
      await expect(pool.query(down!)).rejects.toMatchObject({message:'corporate_admin_extended_slots_in_use'})
      expect((await pool.query('select count(*)::int n from app_private.corporate_admin_logins where enabled')).rows).toEqual([{n:5}])
    } finally {
      await pool.query('delete from app_private.corporate_admin_logins where login_sha256=any($1::text[])',[hashes])
    }
  })
  it('adds a sixth approved administrator while preserving five retained identities and rollback safety', async () => {
    const migration = readFileSync(new URL('../../db/migrations/000193_corporate_admin_six_slots.sql', import.meta.url), 'utf8')
    const [up, down] = migration.split('-- Down Migration')
    const hashes = ['1','2','3','4','5','6'].map(value => value.repeat(64))
    const operator = await import(new URL('../../../../scripts/manage-corporate-admin-access.mjs', import.meta.url).href) as {
      manageCorporateAdminAccess(client: PoolClient, action: 'grant' | 'inspect', hash: string | undefined, slot: number): Promise<{enabled: boolean; bound: boolean; readyProfiles: number; otherEnabledAdmins: number}>
    }
    await pool.query(down!)
    await pool.query(`insert into app_private.corporate_admin_logins(login_sha256,access_slot,subject_sha256,bound_at)
      select value, slot, case when slot<=2 then repeat((slot+10)::text,32) end,
        case when slot<=2 then now() end from unnest($1::text[]) with ordinality as a(value,slot)`, [hashes.slice(0,5)])
    const retained = (await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a order by access_slot')).rows
    try {
      await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,6)', [hashes[5]])).rejects.toMatchObject({code:'23514'})
      await pool.query(up!)
      expect((await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a order by access_slot')).rows).toEqual(retained)
      const client = await pool.connect()
      try {
        expect(await operator.manageCorporateAdminAccess(client,'grant',hashes[5],6)).toEqual({status:'applied',enabled:true,bound:false,readyProfiles:0,otherEnabledAdmins:5})
        expect(await operator.manageCorporateAdminAccess(client,'inspect',hashes[5],6)).toEqual({status:'inspected',enabled:true,bound:false,readyProfiles:0,otherEnabledAdmins:5})
      } finally { client.release() }
      expect((await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a where access_slot<=5 order by access_slot')).rows).toEqual(retained)
      await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,7)', ['b'.repeat(64)])).rejects.toMatchObject({code:'23514'})
      await expect(pool.query('insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,6)', ['b'.repeat(64)])).rejects.toMatchObject({code:'23505'})
      await expect(actor(coach,'update app_private.corporate_admin_logins set enabled=false')).rejects.toMatchObject({code:'42501'})
      await expect(pool.query(down!)).rejects.toMatchObject({message:'corporate_admin_sixth_slot_in_use'})
      await pool.query('update app_private.corporate_admin_logins set enabled=false where access_slot=6')
      await expect(pool.query(down!)).rejects.toMatchObject({message:'corporate_admin_sixth_slot_in_use'})
      expect((await pool.query('select to_jsonb(a) row from app_private.corporate_admin_logins a where access_slot<=5 order by access_slot')).rows).toEqual(retained)
    } finally {
      await pool.query('delete from app_private.corporate_admin_logins where login_sha256=any($1::text[])',[hashes])
      await pool.query(up!)
    }
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
  it('reverses and reapplies corporate migrations and their successors without changing workouts', async () => {
    const url=new URL(source ?? ''); url.pathname=`/${database}`
    const options={ databaseUrl:url.href,dir:directory,migrationsTable:'fit_migrations',migrationsSchema:'app_private',verbose:false,log:()=>{} }
    // Later feature migrations must be rolled back before the corporate boundary.
    // A fixed count silently targets the wrong migrations as the chain grows.
    const applied=await pool.query<{ count:string }>("select count(*) as count from app_private.fit_migrations where name >= '000159_corporate_admin'")
    const count=Number(applied.rows[0]!.count)
    expect(count).toBeGreaterThanOrEqual(2)
    await runner({...options,direction:'down',count})
    expect((await pool.query("select to_regclass('public.corporate_offices') present")).rows).toEqual([{present:null}])
    expect((await pool.query('select status from public.workouts where id=$1',[workout])).rows).toEqual([{status:'done'}])
    await runner({...options,direction:'up'})
    await expect(actor(coach,'select app_private.corporate_admin_bundle_with_identity()')).rejects.toMatchObject({code:'PT403'})
    expect(await actor(coach,'select app_private.is_corporate_admin() allowed')).toEqual([{allowed:false}])
  })
  const invited=randomUUID(), otherInvited=randomUUID()
  const invitation=randomUUID(), invitationHash='7'.repeat(64)
  it('keeps invitation data and the independent pilot private, including for existing Yandex trainers', async()=>{
    await pool.query('insert into app_private.corporate_admins(profile_id) values($1) on conflict(profile_id) do update set enabled=true',[admin])
    await saveOffice(officeId,0)
    await saveTrainer(true,[officeId],0)
    for(const [id,name] of [[invited,'Invited synthetic'],[otherInvited,'Other synthetic']]) {
      await pool.query("insert into public.profiles(id,first_name,account_role) values($1,$2,'trainer')",[id,name])
      await pool.query('insert into public.trainers(profile_id) values($1)',[id])
    }
    for(const id of [invited,coach]) {
      await expect(actor(id,'select app_private.list_corporate_trainer_invitations()')).rejects.toMatchObject({code:'PT403'})
      await expect(actor(id,'insert into app_private.corporate_invitation_pilot_trainers(profile_id,enabled) values($1,true)',[id])).rejects.toMatchObject({code:'42501'})
      await expect(actor(id,'select app_private.claim_corporate_trainer_invitation($1)',[invitationHash])).rejects.toMatchObject({code:'PT403',message:'corporate_invitation_pilot_only'})
    }
    await expect(actor(athlete,'select app_private.claim_corporate_trainer_invitation($1)',[invitationHash])).rejects.toMatchObject({code:'PT403',message:'corporate_trainer_required'})
    await expect(actor(invited,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[invitation,invitationHash,[officeId]])).rejects.toMatchObject({code:'PT403'})
    await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[invitation,invitationHash,[officeId]])
    const preview=(await actor<{v:Record<string,unknown>}>('', 'select app_private.preview_corporate_trainer_invitation($1) v',[invitationHash]))[0]!.v
    expect(preview).toMatchObject({status:'active',offices:[{city:'Санкт-Петербург',name:'Бенуа'}]})
    for(const privateValue of [admin,officeId,invitationHash,'address','createdBy','claimedBy'])expect(JSON.stringify(preview)).not.toContain(privateValue)
  })
  it('requires explicit claim plus administrator confirmation and replays without duplicates or client changes', async()=>{
    await pool.query('insert into app_private.corporate_invitation_pilot_trainers(profile_id,enabled) values($1,true),($2,true)',[invited,otherInvited])
    await actor(invited,'select app_private.claim_corporate_trainer_invitation($1)',[invitationHash])
    await actor(invited,'select app_private.claim_corporate_trainer_invitation($1)',[invitationHash])
    expect((await pool.query('select is_yandex from public.corporate_trainers where trainer_id=$1',[invited])).rows).toEqual([])
    await expect(actor(otherInvited,'select app_private.claim_corporate_trainer_invitation($1)',[invitationHash])).rejects.toMatchObject({code:'PT409'})
    await expect(actor(invited,'select app_private.decide_corporate_trainer_invitation($1,true)',[invitation])).rejects.toMatchObject({code:'PT403'})
    await actor(admin,'select app_private.decide_corporate_trainer_invitation($1,true)',[invitation])
    await actor(admin,'select app_private.decide_corporate_trainer_invitation($1,true)',[invitation])
    expect((await pool.query('select is_yandex from public.corporate_trainers where trainer_id=$1',[invited])).rows).toEqual([{is_yandex:true}])
    expect((await pool.query('select office_id from public.corporate_trainer_offices where trainer_id=$1',[invited])).rows).toEqual([{office_id:officeId}])
    expect((await pool.query<{action:string}>('select action from app_private.corporate_invitation_audit where invitation_id=$1 order by action',[invitation])).rows.map(r=>r.action)).toEqual(['approve','claim','create'])
    expect((await pool.query('select count(*)::int n from public.client_trainers where trainer_id=$1',[invited])).rows).toEqual([{n:0}])
    expect((await pool.query('select count(*)::int n from public.workouts where trainer_id=$1',[invited])).rows).toEqual([{n:0}])
    const list=(await actor<{v:unknown}>(admin,'select app_private.list_corporate_trainer_invitations() v'))[0]!.v
    expect(JSON.stringify(list)).not.toContain(invitationHash)
    expect(JSON.stringify(list)).not.toContain(invited)
  })
  it('handles a lost create response, revocation, expiry and office archival without marking a trainer',async()=>{
    const id=randomUUID(), h='8'.repeat(64), next='9'.repeat(64)
    await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[id,h,[officeId]])
    await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[id,next,[officeId]])
    expect((await actor<{v:unknown}>('', 'select app_private.preview_corporate_trainer_invitation($1) v',[h]))[0]!.v).toBeNull()
    await actor(admin,'select app_private.decide_corporate_trainer_invitation($1,false)',[id])
    await actor(admin,'select app_private.decide_corporate_trainer_invitation($1,false)',[id])
    await expect(actor(otherInvited,'select app_private.claim_corporate_trainer_invitation($1)',[next])).rejects.toMatchObject({code:'PT409'})
    const expired=randomUUID()
    await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[expired,h,[officeId]])
    await pool.query("update app_private.corporate_trainer_invitations set expires_at=now()-interval '1 second' where id=$1",[expired])
    await expect(actor(otherInvited,'select app_private.claim_corporate_trainer_invitation($1)',[h])).rejects.toMatchObject({code:'PT409'})
    const archived=randomUUID(), archiveOffice=randomUUID(), archiveHash='a1'.repeat(32)
    await saveOffice(archiveOffice,0,false,'Invitation archive fixture')
    await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[archived,archiveHash,[archiveOffice]])
    await actor(otherInvited,'select app_private.claim_corporate_trainer_invitation($1)',[archiveHash])
    await saveOffice(archiveOffice,1,true,'Invitation archive fixture')
    await expect(actor(admin,'select app_private.decide_corporate_trainer_invitation($1,true)',[archived])).rejects.toMatchObject({code:'PT422'})
    expect((await pool.query('select is_yandex from public.corporate_trainers where trainer_id=$1',[otherInvited])).rows).toEqual([])
    await pool.query(`insert into app_private.corporate_trainer_invitations(id,token_sha256,created_by,office_ids,created_at,approved_at)
      select gen_random_uuid(),repeat(lpad(seq::text,4,'0'),16),$1,$2::uuid[],now()+interval '1 hour',now() from generate_series(1,401) seq`,[admin,[officeId]])
    const history=(await actor<{v:Array<{id:string}>}>(admin,'select app_private.list_corporate_trainer_invitations() v'))[0]!.v
    expect(history).toHaveLength(400)
    expect(history.some(i=>i.id===archived)).toBe(true)
    expect(history[0]!.id).toBe(archived)

  })

  it('issues only a fresh opaque secret while storing its digest and invalidating a lost create response',async()=>{
    const runtime=new PgDatabasePool({connectionString,max:1})
    try {
      const store=new CorporateInvitationsStore(runtime), id=randomUUID(), session={accessMode:'read_write' as const,token:'a'.repeat(43)}
      const first=await store.create(session,{id,officeIds:[officeId]})
      expect(first.token).toMatch(/^[a-zA-Z0-9_-]{43}$/)
      const stored=(await pool.query<{token_sha256:string}>('select token_sha256 from app_private.corporate_trainer_invitations where id=$1',[id])).rows[0]!.token_sha256
      expect(stored).toBe(createHash('sha256').update(first.token).digest('hex'))
      const second=await store.create(session,{id,officeIds:[officeId]})
      expect(second.id).toBe(first.id);expect(second.token).not.toBe(first.token)
      expect(await store.preview(first.token)).toBeNull()
      expect(await store.preview(second.token)).toMatchObject({status:'active'})
    } finally {await runtime.end()}
  })

  it('rechecks administrator and pilot access after waiting for an owner revocation',async()=>{
    async function revokedWhileWaiting(id:string,sql:string,args:unknown[],revoke:(c:PoolClient)=>Promise<unknown>,message:string) {
      const blocker=await pool.connect(), waiter=await pool.connect()
      let pending:Promise<unknown>|undefined
      try {
        await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(159,1)')
        await waiter.query('begin');await waiter.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await waiter.query('set local role fit_api')
        const pid=(await waiter.query<{pid:number}>('select pg_backend_pid() pid')).rows[0]!.pid
        pending=waiter.query(sql,args).then(()=>null,(error:unknown)=>error)
        let waiting=false
        for(let attempt=0;attempt<100;attempt++) {
          waiting=(await blocker.query("select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted",[pid])).rowCount===1
          if(waiting)break
          await new Promise(resolve=>setTimeout(resolve,10))
        }
        expect(waiting,'The actor must reach the shared lock before access is revoked').toBe(true)
        await revoke(blocker);await blocker.query('commit')
        expect(await pending).toMatchObject({code:'PT403',message})
      } finally {
        await blocker.query('rollback');if(pending)await pending
        await waiter.query('rollback');blocker.release();waiter.release()
      }
    }
    const createId=randomUUID(),revokeId=randomUUID(),claimId=randomUUID()
    const digest=(id:string)=>createHash('sha256').update(id).digest('hex')
    const revokeAdmin=(c:PoolClient)=>c.query('update app_private.corporate_admins set enabled=false where profile_id=$1',[admin])
    try {
      await revokedWhileWaiting(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[createId,digest(createId),[officeId]],revokeAdmin,'corporate_forbidden')
      expect((await pool.query('select id from app_private.corporate_trainer_invitations where id=$1',[createId])).rowCount).toBe(0)
      await pool.query('update app_private.corporate_admins set enabled=true where profile_id=$1',[admin])
      await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[revokeId,digest(revokeId),[officeId]])
      await revokedWhileWaiting(admin,'select app_private.decide_corporate_trainer_invitation($1,false)',[revokeId],revokeAdmin,'corporate_forbidden')
      expect((await pool.query('select revoked_at from app_private.corporate_trainer_invitations where id=$1',[revokeId])).rows).toEqual([{revoked_at:null}])
      await pool.query('update app_private.corporate_admins set enabled=true where profile_id=$1',[admin])
      await actor(admin,'select app_private.create_corporate_trainer_invitation($1,$2,$3::uuid[])',[claimId,digest(claimId),[officeId]])
      await revokedWhileWaiting(otherInvited,'select app_private.claim_corporate_trainer_invitation($1)',[digest(claimId)],c=>c.query('update app_private.corporate_invitation_pilot_trainers set enabled=false where profile_id=$1',[otherInvited]),'corporate_invitation_pilot_only')
      expect((await pool.query('select claimed_at from app_private.corporate_trainer_invitations where id=$1',[claimId])).rows).toEqual([{claimed_at:null}])
      expect((await pool.query('select trainer_id from public.corporate_trainers where trainer_id=$1',[otherInvited])).rowCount).toBe(0)
    } finally {
      await pool.query('update app_private.corporate_admins set enabled=true where profile_id=$1',[admin])
      await pool.query('update app_private.corporate_invitation_pilot_trainers set enabled=true where profile_id=$1',[otherInvited])
    }
  })

})
