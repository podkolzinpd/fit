import {createHash,randomUUID} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {fileURLToPath} from 'node:url'
import {Pool,type PoolClient,type QueryResultRow} from 'pg'
import {runner} from 'node-pg-migrate'
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest'
import {runProgramImport} from '../../../../scripts/cloudru-program-history-write.mjs'
import {readSavePlannedWorkoutRequest} from '../planned-workout-request.js'
import {saveCompletedWorkout} from '../workout-commands.js'
import {createClientCard} from '../domain-commands.js'

const source=process.env.TEST_DATABASE_URL,database=`fit_program_write_${process.pid}`
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
describe.skipIf(source===undefined)('bounded weekly-program writes and closed-receipt recovery',{concurrent:false},()=>{
  let admin:Pool,pool:Pool,created=false
  const connections:PoolClient[]=[]
  beforeAll(async()=>{
    const url=new URL(source??'')
    if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/fit_actor_test')throw Error('local_fit_actor_test_database_required')
    admin=new Pool({connectionString:url.href,max:1})
    await admin.query("do $$ begin perform pg_advisory_xact_lock(193635,1); if not exists(select 1 from pg_roles where rolname='fit_api') then create role fit_api login; end if; end $$")
    await admin.query(`create database ${database} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);created=true;url.pathname=`/${database}`
    await runner({databaseUrl:url.href,dir:fileURLToPath(new URL('../../db/migrations',import.meta.url)),direction:'up',migrationsTable:'fit_migrations',migrationsSchema:'app_private',createMigrationsSchema:true,verbose:false,log:()=>{}})
    pool=new Pool({connectionString:url.href,max:5})
  })
  afterEach(()=>{for(const connection of connections.splice(0))connection.release(true)})
  afterAll(async()=>{if(pool)await pool.end();if(created)await admin.query(`drop database ${database}`);if(admin)await admin.end()})

  async function fixture(format='with_trainer') {
    const owner=await pool.connect(),runtime=await pool.connect();connections.push(owner,runtime);await runtime.query('set role fit_api')
    const coach=randomUUID(),other=randomUUID(),login=hash(`synthetic-program-writer-${coach}`),name='Synthetic program athlete',code=format==='self'?'F09':'F01'
    await owner.query("insert into public.profiles(id,account_role) values($1,'trainer'),($2,'trainer')",[coach,other])
    await owner.query('insert into public.trainers(profile_id) values($1),($2)',[coach,other])
    await owner.query('insert into app_private.fit_lime_pilot_allowlist(login_sha256,profile_id,enabled) values($1,$2,true)',[login,coach])
    await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')",[hash(`synthetic-subject-${coach}`),coach])
    const workouts=['2026-10-26','2026-10-28','2026-10-30'].map((workoutDate,i)=>({requestId:randomUUID(),workoutDate,startTime:null,endTime:null,actualDurationSec:null,trainingFormat:format,notes:`Synthetic source ${i}`,title:`Synthetic day ${i}`,
      exercises:[{position:0,source:'system',ref:`snapshot:synthetic-write:${i}`,customExerciseId:null,name:'Synthetic movement',muscleGroup:'other',inputKind:'strength',blockId:randomUUID(),blockType:'single',blockPreset:'set',blockRounds:1,restBetweenExercisesSec:0,restBetweenRoundsSec:0,restBetweenSetsSec:0,trainerComment:'Literal source',sets:[]}]}))
    const data={schemaVersion:4,code,batchId:`program-history-20261103-${code.toLowerCase()}`,clientName:name,matchNames:[name],workouts}
    const raw=JSON.stringify(data),approvedSha256=hash(raw),encoded=gzipSync(raw).toString('base64'),split=Math.ceil(encoded.length/2)
    let proof:Record<string,unknown>|null=null,binding:string|undefined,started=false
    const receipts:{state:string;receipt:Record<string,unknown>}[]=[],verified:string[]=[]
    const options={mode:'inspect' as const,owner,runtime,legacyId:coach,target:{trainerLoginSha256:login,trainerEmailSha256:hash(`synthetic-email-${coach}`),clientNameSha256:hash(name)},
      parts:[encoded.slice(0,split),encoded.slice(split)],approvedSha256,readRequest:readSavePlannedWorkoutRequest,saveCompleted:saveCompletedWorkout,createCard:createClientCard,
      scopes:[{code,sha256:approvedSha256,workouts:3,exercises:3,sets:0,from:'2026-10-26',to:'2026-10-30',trainingFormat:format}],
      persistReceipt:(state:'prepared'|'committed'|'readback',receipt:Record<string,unknown>)=>{receipts.push({state,receipt:structuredClone(receipt)});return Promise.resolve()},
      selectionBinding:(mode:'inspect'|'apply',value:string)=>{if((binding!==undefined&&binding!==value)||(mode==='apply'&&binding===undefined))throw Error('synthetic_selection_changed');binding=value;return Promise.resolve()},
      beginSingleApply:()=>{if(started)throw Error('program_history_write_verify_required');started=true},
      persistProof:(receipt:Record<string,unknown>)=>{proof=structuredClone(receipt)},readProof:()=>proof,
      markVerified:(status:'complete'|'not_present'|'no_commit')=>{verified.push(status)},preparedReceiptCapability:()=>Promise.resolve()}
    async function card(fullName=name,trainerId=coach,athleteId:string|null=null) {
      const id=randomUUID();await owner.query('insert into public.clients(id,trainer_id,full_name,auth_user_id) values($1,$2,$3,$4)',[id,trainerId,fullName,athleteId])
      await owner.query('insert into public.client_trainers(client_id,trainer_id) values($1,$2)',[id,coach])
      if(athleteId)await owner.query('insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values($1,$2,$3)',[id,coach,athleteId])
      return id
    }
    const count=async(table:string)=>Number((await owner.query<{n:number}>(`select count(*)::int n from public.${table} where trainer_id=$1`,[coach])).rows[0]?.n)
    return {owner,runtime,coach,other,name,options,workouts,receipts,verified,card,count,get proof(){return proof},get started(){return started}}
  }

  it('creates one new card, writes all source rows and verifies the committed graph',async()=>{
    const f=await fixture();await f.card('Unrelated fixture')
    expect(await runProgramImport(f.options)).toMatchObject({status:'ready',selectionBound:true,willCreateCard:true})
    expect(await runProgramImport({...f.options,mode:'apply'})).toMatchObject({status:'imported',workouts:3,createdCard:true,contentVerified:true})
    expect(await f.count('clients')).toBe(2);expect(await f.count('workouts')).toBe(3)
    expect(f.proof).toMatchObject({programCode:'F01',packetSha256:f.options.approvedSha256,createdCard:true})
    expect(f.verified).toEqual(['complete'])
    expect(f.receipts.map(r=>r.state)).toEqual(['readback','prepared','committed','readback'])
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('verify_required')
    expect(await f.count('workouts')).toBe(3)
  })
  it('keeps own workouts self without changing trainer role or creating an authentication account',async()=>{
    const f=await fixture('self')
    const before=(await f.owner.query('select id,account_role from public.profiles order by id')).rows
    await runProgramImport(f.options);expect(await runProgramImport({...f.options,mode:'apply'})).toMatchObject({createdCard:true,contentVerified:true})
    expect((await f.owner.query('select id,account_role from public.profiles order by id')).rows).toEqual(before)
    expect((await f.owner.query<{training_format:string}>('select training_format from public.workouts where created_by=$1',[f.coach])).rows.map(w=>w.training_format)).toEqual(['self','self','self'])
    expect((await f.owner.query<{n:number}>('select count(*)::int n from app_private.auth_identities where profile_id=$1',[f.coach])).rows[0]?.n).toBe(1)
  })
  it('preserves a linked existing card, old records and finances; different same-day history is retained',async()=>{
    const f=await fixture(),athlete=randomUUID()
    await f.owner.query("insert into public.profiles(id,account_role) values($1,'client')",[athlete])
    await f.owner.query("insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key) values($1,'https://push.example.test/program-history','synthetic-key','synthetic-auth')",[athlete])
    const card=await f.card(f.name,f.coach,athlete),old=randomUUID(),packageId=randomUUID()
    await f.owner.query("insert into public.workouts(id,trainer_id,created_by,client_id,workout_date,status,completed_at,notes) values($1,$2,$2,$3,'2026-10-26','done',now(),'Keep old')",[old,f.coach,card])
    await f.owner.query("insert into public.trainer_finance_packages(id,trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,$3,'Keep package',10,50000,'2025-01-01')",[packageId,f.coach,card])
    await f.owner.query("insert into public.trainer_finance_payments(package_id,trainer_id,client_id,amount_cents,received_on) values($1,$2,$3,50000,'2025-01-01')",[packageId,f.coach,card])
    const before=(await f.owner.query('select to_jsonb(w) value from public.workouts w where id=$1',[old])).rows
    const finances=async()=>Promise.all(['trainer_finance_packages','trainer_finance_payments'].map(async table=>(await f.owner.query<{value:unknown}>(`select to_jsonb(x) value from public.${table} x where client_id=$1 order by id`,[card])).rows))
    const financialBefore=await finances()
    await runProgramImport(f.options)
    expect(await runProgramImport({...f.options,mode:'apply'})).toMatchObject({createdCard:false,contentVerified:true,previousStateVerified:true})
    expect((await f.owner.query('select to_jsonb(w) value from public.workouts w where id=$1',[old])).rows).toEqual(before)
    expect(await finances()).toEqual(financialBefore);expect(await f.count('workouts')).toBe(4)
    expect((await f.owner.query<{n:number}>("select count(*)::int n from public.trainer_finance_sessions where client_id=$1 and (package_id is not null or disposition<>'unassigned')",[card])).rows[0]?.n).toBe(0)
  })
  it('rolls back the new card and all rows after a late domain-command failure',async()=>{
    const f=await fixture();await runProgramImport(f.options);let calls=0
    await expect(runProgramImport({...f.options,mode:'apply',saveCompleted:async(...args:Parameters<typeof saveCompletedWorkout>)=>{
      const result=await saveCompletedWorkout(...args);if(++calls===2)throw Error('synthetic late failure');return result
    }})).rejects.toThrow('failed_rolled_back')
    expect(await f.count('clients')).toBe(0);expect(await f.count('workouts')).toBe(0)
    expect(f.proof).toBeNull();expect(f.started).toBe(true)
    expect(await runProgramImport({...f.options,mode:'verify'})).toMatchObject({status:'no_commit',readOnly:true,workouts:0})
  })
  it('verifies an unknown committed outcome using the prepared proof and refuses a second apply',async()=>{
    const f=await fixture();await runProgramImport(f.options)
    await expect(runProgramImport({...f.options,mode:'apply',persistReceipt:async(state,receipt)=>{
      await f.options.persistReceipt(state,receipt);if(state==='committed')throw Error('synthetic lost receipt reply')
    }})).rejects.toThrow('outcome_requires_readback')
    expect(await f.count('workouts')).toBe(3);expect(f.proof).not.toBeNull();expect(f.verified).toEqual([])
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('verify_required')
    expect(await runProgramImport({...f.options,mode:'verify'})).toMatchObject({status:'verified',readOnly:true,contentVerified:true,workouts:3})
    expect(f.verified).toEqual(['complete']);expect(await f.count('clients')).toBe(1)
  })
  it('keeps a prepared proof after rollback and reconciles absence without retrying a write',async()=>{
    const f=await fixture();await runProgramImport(f.options)
    await expect(runProgramImport({...f.options,mode:'apply',persistReceipt:async(state,receipt)=>{
      if(state==='prepared')throw Error('synthetic object store unavailable');await f.options.persistReceipt(state,receipt)
    }})).rejects.toThrow('failed_rolled_back')
    expect(f.proof).not.toBeNull();expect(await f.count('workouts')).toBe(0)
    expect(await runProgramImport({...f.options,mode:'verify'})).toMatchObject({status:'not_present',readOnly:true,workouts:0})
    expect(f.verified).toEqual(['not_present'])
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('verify_required')
  })
  it('rejects changed selection and stale old state after inspection, without overwriting the edit',async()=>{
    const f=await fixture(),id=await f.card();await runProgramImport(f.options)
    await f.owner.query("update public.clients set goal='Changed after inspection' where id=$1",[id])
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('selection_changed')
    expect(await f.count('workouts')).toBe(0);expect(f.started).toBe(false)
    expect((await f.owner.query<{goal:string}>('select goal from public.clients where id=$1',[id])).rows[0]?.goal).toBe('Changed after inspection')
  })
  it('rejects a lossy writer before commit and does not hide source facts',async()=>{
    const f=await fixture();await runProgramImport(f.options)
    await expect(runProgramImport({...f.options,mode:'apply',saveCompleted:async(...args:Parameters<typeof saveCompletedWorkout>)=>{
      const [client,draft,version]=args
      return saveCompletedWorkout(client,{...draft,exercises:draft.exercises.map(e=>({...e,trainerComment:'Dropped source'}))},version)
    }})).rejects.toThrow('content_readback_failed')
    expect(await f.count('workouts')).toBe(0);expect(await f.count('clients')).toBe(0)
  })
  it('refuses a proof from another packet and detects edits after an uncertain commit',async()=>{
    const f=await fixture();await runProgramImport(f.options)
    await expect(runProgramImport({...f.options,mode:'apply',persistReceipt:async(state,receipt)=>{
      await f.options.persistReceipt(state,receipt);if(state==='committed')throw Error('synthetic interrupted reply')
    }})).rejects.toThrow('outcome_requires_readback')
    await expect(runProgramImport({...f.options,mode:'verify',readProof:()=>({...f.proof,packetSha256:'0'.repeat(64)})})).rejects.toThrow('private_proof_invalid')
    await f.owner.query("update public.workouts set notes='Edited after commit' where created_by=$1",[f.coach])
    await expect(runProgramImport({...f.options,mode:'verify'})).rejects.toThrow('content_readback_failed')
    expect(await f.count('workouts')).toBe(3);expect(f.verified).toEqual([])
    expect(f.receipts.at(-1)?.state).toBe('prepared')
  })
  it('requires a bound read-only inspection before the first apply',async()=>{
    const f=await fixture()
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('selection_changed')
    expect(f.started).toBe(false);expect(await f.count('clients')).toBe(0)
    expect(await f.count('workouts')).toBe(0)
  })
  it('holds existing matching history for review rather than skipping or duplicating it blindly',async()=>{
    const f=await fixture(),card=await f.card()
    const parsed=readSavePlannedWorkoutRequest({...f.workouts[0],clientId:card,requestId:randomUUID()},null)
    if(!parsed)throw Error('synthetic_completed_source_required')
    await f.runtime.query('begin');await f.runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[f.coach])
    await saveCompletedWorkout({query:async<Row extends QueryResultRow>(sql:string,args?:readonly unknown[])=>(await f.runtime.query<Row>(sql,args?[...args]:undefined)).rows},parsed.draft,null)
    await f.runtime.query('commit')
    await expect(runProgramImport(f.options)).rejects.toThrow('source_review_required')
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('source_review_required')
    expect(await f.count('workouts')).toBe(1);expect(f.started).toBe(false)
  })
})
