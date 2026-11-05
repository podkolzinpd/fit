import {randomUUID,createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {runner} from 'node-pg-migrate'
import {Pool,type QueryResultRow} from 'pg'
import {readOwnProfile} from '../profile.js'
import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {planAthleteRestore,applyAthleteRestore,verifyAthleteRestore,type AthletePair,type AthletePlan} from '../../../../scripts/cloudru-athlete-access-restore.mjs'
const source=process.env.TEST_DATABASE_URL
const database=`fit_athlete_restore_${process.pid}`
describe.skipIf(source===undefined)('proven athlete card access preserves both profiles and all history with real RLS',()=>{
  let admin: Pool, owner: Pool, runtime: Pool
  let created = false, createdOwner = false
  beforeAll(async () => {
    const url = new URL(source ?? '')
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fit_actor_test') throw Error('local_test_database_required')
    admin = new Pool({ connectionString: url.href, max: 1 })
    await admin.query('begin')
    await admin.query('select pg_advisory_xact_lock(193635,1)')
    if (!(await admin.query("select 1 from pg_roles where rolname='fit_api'")).rowCount) await admin.query('create role fit_api')
    if (!(await admin.query("select 1 from pg_roles where rolname='fit_owner'")).rowCount) {
      await admin.query('create role fit_owner'); createdOwner = true
    }
    await admin.query('commit')
    await admin.query(`create database ${database} owner fit_owner`); created = true
    url.pathname = `/${database}`
    // Test-only SET ROLE matches the existing operational-test bootstrap.
    // Production connects directly with its protected owner/runtime credentials.
    owner = new Pool({ connectionString: url.href, options: '-c role=fit_owner', max: 2 })
    const migrating = await owner.connect()
    try {
      await runner({ dbClient: migrating, dir: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
        direction: 'up', migrationsTable: 'fit_migrations', migrationsSchema: 'app_private',
        createMigrationsSchema: true, verbose: false, log: () => {} })
    } finally { migrating.release() }
    runtime = new Pool({ connectionString: url.href, options: '-c role=fit_api', max: 1 })
  },60000)
  afterAll(async () => {
    if (runtime) await runtime.end()
    if (owner) await owner.end()
    if (created) await admin.query(`drop database ${database}`)
    if (createdOwner) await admin.query('drop role fit_owner')
    if (admin) await admin.end()
  })

 async function fixture(){
  const legacyId=randomUUID(),currentId=randomUUID(),trainerId=randomUUID(),card=randomUUID(),old=randomUUID()
  await owner.query(`insert into public.profiles(id,first_name,account_role) values
   ($1,'Synthetic old','client'),($2,'Synthetic new','client'),($3,'Synthetic coach','trainer')`,[legacyId,currentId,trainerId])
  await owner.query('insert into public.trainers(profile_id) values($1)',[trainerId])
  await owner.query(`insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin)
   values('yandex',$1,$2,'native')`,[createHash('sha256').update(currentId).digest('hex'),currentId])
  await owner.query(`insert into public.clients(id,trainer_id,auth_user_id,full_name) values($1,$2,$2,'Synthetic canonical')`,[card,legacyId])
  await owner.query(`insert into public.clients(id,trainer_id,full_name,merged_into_client_id) values($1,$2,'Synthetic source',$3)`,[old,trainerId,card])
  await owner.query(`insert into public.client_trainers(client_id,trainer_id,note) values($1,$2,'Private synthetic coach note') on conflict do nothing`,[card,trainerId])
  await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',[card,trainerId,legacyId])
  const workouts=(await owner.query<{id:string}>(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,completed_at,notes)
   select $1,$2,$3,current_date-n,'done',now()-interval '1 day','Private synthetic result' from generate_series(1,21) n returning id`,[card,legacyId,trainerId])).rows
  await owner.query(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,started_at) values($1,$2,$3,current_date,'in_progress',now())`,[card,legacyId,trainerId])
  const exercise=(await owner.query<{id:string}>(`insert into public.workout_exercises(workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind)
   values($1,$2,$3,0,'system','fixture:athlete','Synthetic exercise','back','strength') returning id`,[workouts[0]!.id,legacyId,card])).rows[0]!
  await owner.query(`insert into public.workout_sets(workout_exercise_id,trainer_id,client_id,position,plan_weight_kg,plan_reps,fact_weight_kg,fact_reps,confirmed_at)
   values($1,$2,$3,0,3,12,3.4,10,now())`,[exercise.id,legacyId,card])
  await owner.query(`insert into public.assistant_conversations(owner_id,title) values($1,'New private synthetic conversation')`,[currentId])
  return {legacyId,currentId,trainerId,card,old}
 }
 async function plan(f:AthletePair){const c=await owner.connect();try{return await planAthleteRestore(c,{legacyId:f.legacyId,currentId:f.currentId,trainerId:f.trainerId})}finally{c.release()}}
 async function apply(p:AthletePlan,backupVerified=true){const c=await owner.connect();try{return await applyAthleteRestore(c,p,{backupVerified})}finally{c.release()}}
 async function verify(p:AthletePlan){const c=await runtime.connect();try{return await verifyAthleteRestore(c,p,{readProfile:()=>readOwnProfile({query:async<Row extends QueryResultRow>(text:string,values?:readonly unknown[])=>(await c.query<Row>(text,values?[...values]:undefined)).rows})})}finally{c.release()}}
 it('changes only one card owner; keeps 21 done + active workout, decimal facts, both profiles and new private history',async()=>{
  const f=await fixture(),p=await plan(f)
  expect(p.ready).toBe(true)
  expect(p.report).toMatchObject({repairReady:true,uncoveredOldData:[]})
  await expect(verify(p)).rejects.toThrow('runtime_own_profile')
  await expect(apply(p,false)).rejects.toThrow('backup_required')
  expect(await apply(p)).toMatchObject({changedCards:1,historyUnchanged:true,identityAndCurrentProfileUnchanged:true})
  expect(await verify(p)).toMatchObject({athleteCanReadHistory:true,trainerCanReadHistory:true,preservedWorkouts:22})
  expect(await apply(p)).toMatchObject({replayed:true})
  expect((await owner.query('select trainer_id,auth_user_id from public.clients where id=$1',[f.card])).rows).toEqual([{trainer_id:f.legacyId,auth_user_id:f.currentId}])
  expect(Number((await owner.query<{weight:string}>('select fact_weight_kg::text weight from public.workout_sets where client_id=$1',[f.card])).rows[0]?.weight)).toBe(3.4)
  expect((await owner.query<{count:number}>('select count(*)::int count from public.assistant_conversations where owner_id=$1',[f.currentId])).rows[0]?.count).toBe(1)
  expect(JSON.stringify(p.report)).not.toContain(f.currentId)
  expect(JSON.stringify(p.report)).not.toContain('Private synthetic')
 })
 it('refuses old actor-owned private history rather than leaving it behind',async()=>{
  const f=await fixture()
  await owner.query(`insert into public.assistant_conversations(owner_id,title) values($1,'Old private synthetic history')`,[f.legacyId])
  const p=await plan(f);expect(p.ready).toBe(false)
  expect(p.report).toMatchObject({uncoveredOldData:[{table:'assistant_conversations',count:1}]})
  await expect(apply(p)).rejects.toThrow('plan')
  expect((await owner.query<{auth_user_id:string}>('select auth_user_id from public.clients where id=$1',[f.card])).rows[0]?.auth_user_id).toBe(f.legacyId)
 })
 it('unknown private owner history also blocks a repair instead of being treated as infrastructure',async()=>{
  const f=await fixture()
  await owner.query('create table app_private.athlete_restore_unknown_private_data(owner_id uuid references public.profiles(id),payload text)')
  await owner.query(`insert into app_private.athlete_restore_unknown_private_data values($1,'Private synthetic unpublished plan')`,[f.legacyId])
  const p=await plan(f);expect(p.ready).toBe(false)
  expect(p.report).toMatchObject({uncoveredOldData:[{table:'athlete_restore_unknown_private_data',count:1}]})
  await expect(apply(p)).rejects.toThrow('plan')
 })
 it('retains new training data by rejecting a stale plan and including it in the next plan',async()=>{
  const f=await fixture(),p=await plan(f)
  await owner.query(`insert into public.workouts(client_id,trainer_id,created_by,workout_date,status,completed_at) values($1,$2,$3,current_date,'done',now())`,[f.card,f.legacyId,f.trainerId])
  await expect(apply(p)).rejects.toThrow('state_changed')
  const fresh=await plan(f);await apply(fresh)
  expect(await verify(fresh)).toMatchObject({preservedWorkouts:23})
 })
 it('refuses a current owned card or pending deletion without changing any ownership',async()=>{
  const f=await fixture(),p=await plan(f)
  await owner.query(`insert into public.clients(trainer_id,auth_user_id,full_name) values($1,$1,'New actual card')`,[f.currentId])
  await expect(apply(p)).rejects.toThrow('canonical')
  const g=await fixture();await owner.query('insert into public.account_deletion_requests(user_id) values($1)',[g.currentId])
  await expect(plan(g)).rejects.toThrow('deletion_pending')
 })
 it('rejects identity changes and preserves the confirmed current identity',async()=>{
  const f=await fixture(),p=await plan(f)
  await owner.query(`insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'linked')`,[createHash('sha256').update(f.legacyId).digest('hex'),f.legacyId])
  await expect(apply(p)).rejects.toThrow('profile_proof')
  expect((await owner.query('select profile_id from app_private.auth_identities where profile_id=$1',[f.currentId])).rows).toEqual([{profile_id:f.currentId}])
 })
 it('rolls back the ownership change if a postcondition query fails',async()=>{
  const f=await fixture(),p=await plan(f),c=await owner.connect();let changed=false
  try{
   await expect(applyAthleteRestore({query:async(sql:string,values?:unknown[])=>{
    if(changed&&sql.startsWith('select p.id,p.account_role'))throw Error('synthetic postcondition failure')
    const r=await c.query(sql,values);if(sql.startsWith('update public.clients set auth_user_id'))changed=true;return r
   }},p,{backupVerified:true})).rejects.toThrow('synthetic postcondition failure')
   expect((await c.query<{auth_user_id:string}>('select auth_user_id from public.clients where id=$1',[f.card])).rows[0]?.auth_user_id).toBe(f.legacyId)
  }finally{c.release()}
 })
})
