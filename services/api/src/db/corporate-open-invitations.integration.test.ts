import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool, type QueryResultRow } from 'pg'
import { runner } from 'node-pg-migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CorporateInvitationsStore } from '../corporate-invitations.js'
import { CorporateAdminStore } from '../corporate-admin.js'
import { PgDatabasePool } from './pg-pool.js'

const source=process.env.TEST_DATABASE_URL, database=`fit_open_invitations_${process.pid}`
describe.skipIf(!source)('open corporate invitations — real PostgreSQL17/actor/RLS',()=>{
 let owner:Pool,pool:Pool,runtime:PgDatabasePool,created=false
 const admin=randomUUID(),coach=randomUUID(),other=randomUUID(),athlete=randomUUID(),office=randomUUID()
 const cohort=[coach,...Array.from({length:5},()=>randomUUID())]
 const token='s'.repeat(43), session={accessMode:'read_write' as const,token}
 async function actor<T extends QueryResultRow=QueryResultRow>(id:string,sql:string,args:unknown[]=[]) {
  const c=await pool.connect()
  try{await c.query('begin');await c.query('set local role fit_api');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);const result=await c.query<T>(sql,args);await c.query('commit');return result.rows}
  catch(e){await c.query('rollback');throw e}finally{c.release()}
 }
 const create=async(email='synthetic@example.test')=>{const id=randomUUID(),hash=createHash('sha256').update(id).digest('hex');await actor(admin,'select app_private.create_corporate_invitation_for_recipient($1,$2,$3,$4)',[id,hash,[office],email]);return{id,hash}}
 const claim=(hash:string,id=coach)=>actor(id,'select app_private.claim_corporate_trainer_invitation($1) status',[hash])
 const approve=(id:string)=>actor(admin,'select app_private.confirm_corporate_invitation_testing($1)',[id])
 const setTesting=(enabled:boolean,version:number)=>actor(admin,'select app_private.set_corporate_testing($1,$2,$3)',[coach,enabled,version])
 const access=(id=coach)=>actor(id,'select app_private.corporate_services_allowed() services,app_private.corporate_personal_allowed() personal,app_private.corporate_duty_allowed() duty,app_private.corporate_profile_available($1) profile',[id])
 beforeAll(async()=>{
  const url=new URL(source??'');if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!='/fit_actor_test')throw Error('local_test_database_required')
  owner=new Pool({connectionString:url.href});await owner.query(`do $$ begin perform pg_advisory_xact_lock(193635,1);if not exists(select 1 from pg_roles where rolname='fit_api')then create role fit_api login;end if;end $$`)
  await owner.query(`create database ${database}`);created=true;url.pathname=`/${database}`
  await runner({databaseUrl:url.href,dir:fileURLToPath(new URL('../../db/migrations',import.meta.url)),direction:'up',migrationsTable:'fit_migrations',migrationsSchema:'app_private',createMigrationsSchema:true,verbose:false,log:()=>{}})
  pool=new Pool({connectionString:url.href,max:6});runtime=new PgDatabasePool({connectionString:url.href,options:'-c role=fit_api',max:2})
  for(const id of [admin,...cohort,other,athlete]){await pool.query("insert into public.profiles(id,first_name,account_role)values($1,'Synthetic',$2)",[id,[admin,athlete].includes(id)?'client':'trainer']);if([...cohort,other].includes(id))await pool.query('insert into public.trainers(profile_id)values($1)',[id])}
  await pool.query('insert into app_private.corporate_admins(profile_id)values($1)',[admin])
  await actor(admin,'select app_private.save_corporate_office($1,$2,$3,$4,false,0)',[office,'Synthetic','Test','Test'])
  await pool.query("insert into app_private.profile_rollout_assignments(profile_id,target_backend,access_mode,enabled)values($1,'yandex','read_write',true)",[admin])
  await pool.query("insert into app_private.yandex_app_sessions(token_sha256,profile_id,expires_at)values($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),admin])
 },90000)
 beforeEach(async()=>{
  await pool.query('delete from app_private.corporate_testing_audit');await pool.query('delete from app_private.corporate_testing_trainers');await pool.query('delete from app_private.corporate_profile_management')
  await pool.query('delete from app_private.corporate_invitation_audit');await pool.query('delete from app_private.corporate_trainer_invitations')
  await pool.query('delete from public.corporate_trainer_offices');await pool.query('delete from public.corporate_trainers')
  await pool.query('update app_private.corporate_admins set enabled=true');await pool.query("update public.profiles set account_role='trainer' where id=$1",[coach])
 })
 afterAll(async()=>{if(runtime)await runtime.end();if(pool)await pool.end();if(created)await owner.query(`drop database ${database}`);if(owner)await owner.end()})
 it('admits six distinct recipients with no closed pilot, binds actual claimants, and enrolls only after confirmation',async()=>{
  for(const [n,domain]of ['mail.ru','gmail.com','yandex.ru','inbox.ru','example.test','another.test'].entries()){
   const recipient=await create(` Synthetic${n}@${domain.toUpperCase()} `)
   expect(await claim(recipient.hash,cohort[n])).toEqual([{status:'claimed'}]);expect(await access(cohort[n])).toEqual([{services:false,personal:false,duty:false,profile:false}])
   await approve(recipient.id);expect(await access(cohort[n])).toEqual([{services:true,personal:true,duty:true,profile:true}])
   expect((await pool.query('select managed from app_private.corporate_profile_management')).rows).toEqual([])
  }
  expect((await pool.query('select count(*)::int n from app_private.corporate_testing_trainers where enabled')).rows).toEqual([{n:6}])
  expect((await pool.query('select count(*)::int n from app_private.corporate_invitation_pilot_trainers')).rows).toEqual([{n:0}])
  expect((await pool.query('select count(*)::int n from app_private.corporate_admins')).rows).toEqual([{n:1}])
 })
 it('keeps addressed email admin-only and unrelated to identity, never creates or upgrades accounts',async()=>{
  const {id,hash}=await create(' Unrelated@MAIL.RU ')
  const store=new CorporateInvitationsStore(runtime)
  expect(JSON.stringify(await store.preview('a'.repeat(43)))).not.toContain('unrelated')
  const preview=await actor<{v:unknown}>('','select app_private.preview_corporate_trainer_invitation($1) v',[hash]);expect(JSON.stringify(preview)).not.toContain('unrelated')
  const list=(await store.list(session)).invitations;expect(list).toContainEqual(expect.objectContaining({id,recipientEmail:'unrelated@mail.ru'}))
  await claim(hash);await approve(id)
  expect((await pool.query('select trainer_id from app_private.corporate_testing_trainers')).rows).toEqual([{trainer_id:coach}])
  for(const table of ['corporate_testing_trainers','corporate_testing_audit','corporate_trainer_invitations'])await expect(actor(coach,`select * from app_private.${table}`)).rejects.toMatchObject({code:'42501'})
  await expect(actor(other,'select app_private.set_corporate_testing($1,true,0)',[other])).rejects.toMatchObject({code:'PT403'})
 })
 it('normalizes recipient deduplication and preserves operation identity across lost responses',async()=>{
  const {id}=await create();await expect(create(' SYNTHETIC@EXAMPLE.TEST ')).rejects.toMatchObject({message:'corporate_recipient_pending'})
  await expect(actor(admin,'select app_private.create_corporate_invitation_for_recipient($1,$2,$3,$4)',[id,'f'.repeat(64),[office],'changed@example.test'])).rejects.toMatchObject({code:'PT409'})
  const store=new CorporateInvitationsStore(runtime), command={id:randomUUID(),officeIds:[office],recipientEmail:'other@example.test'}
  const a=await store.create(session,command),b=await store.create(session,command)
  expect(a.token).not.toBe(b.token);expect(await store.preview(a.token)).toBeNull();expect(await store.preview(b.token)).toMatchObject({status:'active'})
  for(const email of ['bad','a@b','a@b.c\nheader','a'.repeat(250)+'@example.test'])await expect(create(email)).rejects.toMatchObject({code:'PT422'})
 })
 it('preserves token/role/single-claim/expiry/revocation guards and never enrolls on claim',async()=>{
  const {id,hash}=await create();await expect(claim(hash,athlete)).rejects.toMatchObject({message:'corporate_trainer_required'})
  await claim(hash);await expect(claim(hash,other)).rejects.toMatchObject({code:'PT409'})
  await actor(admin,'select app_private.decide_corporate_trainer_invitation($1,false)',[id]);await expect(approve(id)).rejects.toMatchObject({code:'PT409'})
  const expired=await create('expired@example.test');await pool.query("update app_private.corporate_trainer_invitations set expires_at=now()-interval '1 second' where id=$1",[expired.id]);await expect(claim(expired.hash)).rejects.toMatchObject({code:'PT409'})
  expect((await pool.query('select count(*)::int n from app_private.corporate_testing_trainers')).rows).toEqual([{n:0}])
 })
 it('supports existing confirmed members, CAS and idempotent approval without resurrecting revoked access',async()=>{
  await actor(admin,'select app_private.save_corporate_trainer($1,true,$2,0)',[coach,[office]])
  const {id,hash}=await create();await claim(hash);await approve(id);await approve(id)
  expect((await pool.query('select version from app_private.corporate_testing_trainers')).rows).toEqual([{version:'1'}])
  await setTesting(false,1);await approve(id);expect(await access()).toEqual([{services:false,personal:false,duty:false,profile:false}])
  await expect(setTesting(true,0)).rejects.toMatchObject({code:'PT409'});await setTesting(true,2)
  const adminStore=new CorporateAdminStore(runtime);const bundle=await adminStore.bundle(session)
  expect(bundle.trainers).toContainEqual(expect.objectContaining({id:coach,testingEnabled:true,testingVersion:3,profileEditingAvailable:true}))
 })
 it('adds invited offices to an existing member without replacing previous assignments',async()=>{
  const previousOffice=randomUUID();await actor(admin,'select app_private.save_corporate_office($1,$2,$3,$4,false,0)',[previousOffice,'Synthetic','Previous','Test'])
  await actor(admin,'select app_private.save_corporate_trainer($1,true,$2,0)',[coach,[previousOffice]])
  const {id,hash}=await create();await claim(hash);await approve(id)
  expect((await pool.query<{office_id:string}>('select office_id from public.corporate_trainer_offices where trainer_id=$1',[coach])).rows.map(r=>r.office_id).sort()).toEqual([office,previousOffice].sort())
  await approve(id);expect((await pool.query('select version from public.corporate_trainers where trainer_id=$1',[coach])).rows).toEqual([{version:'2'}])
 })
 it('does not rewrite independent pilots and refuses enrollment removal while profile management is on',async()=>{
  const tables=['corporate_service_pilot_trainers','corporate_personal_pilot_trainers','corporate_duty_pilot_trainers','corporate_profile_pilot_trainers']
  for(const table of tables)await pool.query(`insert into app_private.${table}(profile_id,enabled)values($1,false)`,[other])
  const before=await Promise.all(tables.map(table=>pool.query(`select * from app_private.${table} order by profile_id`)))
  const {id,hash}=await create();await claim(hash);await approve(id)
  await pool.query('insert into app_private.corporate_profile_management(trainer_id,managed)values($1,true)',[coach])
  await expect(setTesting(false,1)).rejects.toMatchObject({message:'corporate_testing_managed'})
  await actor(admin,'select app_private.save_corporate_trainer($1,false,$2,1)',[coach,[]])
  expect(await access()).toEqual([{services:false,personal:false,duty:false,profile:false}])
  expect((await pool.query('select managed from app_private.corporate_profile_management')).rows).toEqual([{managed:false}])
  await actor(admin,'select app_private.save_corporate_trainer($1,true,$2,2)',[coach,[office]])
  expect(await access()).toEqual([{services:false,personal:false,duty:false,profile:false}])
  for(const [n,table]of tables.entries())expect((await pool.query(`select * from app_private.${table} order by profile_id`)).rows).toEqual(before[n]!.rows)
 })
})
