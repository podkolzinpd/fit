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
  afterAll(async()=>{
    if(pool)await pool.end()
    if(created)await admin.query(`drop database ${database}`)
    if(admin){
      // The last disposable database releases the shared fixture role. A later
      // recovery CI step must be able to create its own unrelated fit_owner.
      await admin.query(`do $$ begin perform pg_advisory_xact_lock(193635,2);
        if exists(select 1 from pg_roles r where r.rolname='fit_owner'
          and shobj_description(r.oid,'pg_authid')='private-program-roster-fixture-20261105'
          and not exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=r.oid))
        then execute 'drop role fit_owner';end if;end $$`)
      await admin.end()
    }
  })

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

  it.each(['single','merged','linked-merged'])('uses separate live roster evidence and preserves the existing card and merged predecessor: %s',async kind=>{
    const merged=kind!=='single',linked=kind==='linked-merged'
    const f=await fixture(),id=await f.card(f.name,linked?f.other:f.coach,linked?f.other:null),names=[f.name]
    const old=merged?await f.card():null
    if(old)await f.owner.query('update public.clients set archived_at=now(),merged_into_client_id=$1 where id=$2',[id,old])
    const currentBefore=(await f.owner.query('select to_jsonb(c) value from public.clients c where id=$1',[id])).rows
    const archivedBefore=old?(await f.owner.query('select to_jsonb(c) value from public.clients c where id=$1',[old])).rows:null
    for(let i=1;i<17;i++){const name=`Synthetic writer roster ${f.coach} ${i}`;names.push(name);await f.card(name)}
    await f.owner.query('delete from app_private.fit_lime_pilot_allowlist where profile_id=$1',[f.coach])
    // Migrations run as postgres in this disposable fixture; emulate their production owner only for the readonly connection.
    await f.owner.query("do $$ begin perform pg_advisory_xact_lock(193635,2);if not exists(select 1 from pg_roles where rolname='fit_owner') then create role fit_owner;comment on role fit_owner is 'private-program-roster-fixture-20261105';elsif not exists(select 1 from pg_roles r where r.rolname='fit_owner' and shobj_description(r.oid,'pg_authid')='private-program-roster-fixture-20261105') then raise exception 'foreign_fixture_owner_role';end if;end $$;alter role fit_owner bypassrls;grant usage on schema public,app_private to fit_owner;grant select on all tables in schema public,app_private to fit_owner;grant execute on function public.is_active_client_trainer_connection(uuid,uuid) to fit_owner;grant execute on function public.can_read_workout(uuid) to fit_owner")
    const target=f.options.target,trainerEvidence={version:1,targetBinding:hash(JSON.stringify([target.trainerEmailSha256,target.trainerLoginSha256,target.clientNameSha256])),
      rosterNameHashes:names.map(n=>hash(n.toLowerCase()))}
    await f.owner.query('set role fit_owner')
    const options={...f.options,legacyId:null,trainerEvidence}
    expect(await runProgramImport(options)).toMatchObject({status:'ready',willCreateCard:false})
    expect(await runProgramImport({...options,mode:'apply'})).toMatchObject({status:'imported',createdCard:false,workouts:3,contentVerified:true,previousStateVerified:true})
    expect(f.proof).toMatchObject({clientId:id,trainerId:f.coach,createdCard:false})
    expect(await runProgramImport({...options,mode:'verify'})).toMatchObject({status:'verified',workouts:3,readOnly:true})
    expect(await f.count('clients')).toBe((merged?18:17)-(linked?1:0))
    expect((await f.owner.query('select to_jsonb(c) value from public.clients c where id=$1',[id])).rows).toEqual(currentBefore)
    if(old)expect((await f.owner.query('select to_jsonb(c) value from public.clients c where id=$1',[old])).rows).toEqual(archivedBefore)
  })
  it('creates one new card, writes all source rows and verifies the committed graph',async()=>{
    const f=await fixture();await f.card('Unrelated fixture')
    expect(await runProgramImport(f.options)).toMatchObject({status:'ready',selectionBound:true,willCreateCard:true})
    expect(await runProgramImport({...f.options,mode:'apply'})).toMatchObject({status:'imported',workouts:3,createdCard:true,contentVerified:true})
    expect(await f.count('clients')).toBe(2);expect(await f.count('workouts')).toBe(3)
    expect(f.proof).toMatchObject({programCode:'F01',packetSha256:f.options.approvedSha256,createdCard:true,financeAttendanceVersion:1})
    expect(f.verified).toEqual(['complete'])
    expect(f.receipts.map(r=>r.state)).toEqual(['readback','prepared','committed','readback'])
    await expect(runProgramImport({...f.options,mode:'apply'})).rejects.toThrow('verify_required')
    expect(await f.count('workouts')).toBe(3)
  })
  it('distinguishes an unresolved email from a missing Yandex link without selecting or writing an identity',async()=>{
    for(const missing of ['email_binding','yandex_link']) {
      const f=await fixture()
      if(missing==='email_binding')await f.owner.query('delete from app_private.fit_lime_pilot_allowlist where profile_id=$1',[f.coach])
      else await f.owner.query('delete from app_private.auth_identities where profile_id=$1',[f.coach])
      const options={...f.options,legacyId:missing==='email_binding'?null:f.coach}
      const before=(await f.owner.query('select to_jsonb(p) value from public.profiles p order by id')).rows
      expect(await runProgramImport(options)).toEqual({status:'identity_requires_review',code:'F01',workouts:0,
        readOnly:true,productionMutated:false,trainerVerified:false,legacyRegistryMatched:missing!=='email_binding',
        retainedLoginBinding:missing!=='email_binding',reason:missing==='email_binding'?'email_binding_missing':'yandex_identity_missing',
        identityAuditVersion:1,retainedSourcesChecked:expect.any(Number) as unknown,retainedProfileCandidates:missing==='email_binding'?0:1,
        linkedTrainerCandidates:0,retainedBindingSources:missing==='email_binding'?[]:['fit_lime_pilot_allowlist']})
      expect(f.receipts).toHaveLength(1)
      expect(f.receipts[0]?.receipt).toMatchObject({kind:'program_identity_inspection',packetSha256:options.approvedSha256})
      expect(f.receipts[0]?.receipt.targetBinding).toBe(hash(JSON.stringify([
        options.target.trainerEmailSha256,options.target.trainerLoginSha256,options.target.clientNameSha256])))
      expect(JSON.stringify(f.receipts)).not.toContain(f.coach)
      expect(f.started).toBe(false);expect(f.proof).toBeNull();expect(f.verified).toEqual([])
      for(const mode of ['apply','verify'] as const)await expect(runProgramImport({...options,mode})).rejects.toThrow('current_trainer_identity_required')
      expect(await f.count('clients')).toBe(0);expect(await f.count('workouts')).toBe(0)
      expect((await f.owner.query('select to_jsonb(p) value from public.profiles p order by id')).rows).toEqual(before)
    }
  })
  it('reports a retained mapping outside the three importer sources without selecting an actor',async()=>{
    const f=await fixture()
    await f.owner.query('delete from app_private.fit_lime_pilot_allowlist where profile_id=$1',[f.coach])
    await f.owner.query('create table if not exists app_private.program_lookup_fixture(login_sha256 text,profile_id uuid)')
    await f.owner.query('insert into app_private.program_lookup_fixture values($1,$2)',[f.options.target.trainerLoginSha256,f.coach])
    const options={...f.options,legacyId:null}
    expect(await runProgramImport(options)).toEqual({status:'identity_requires_review',code:'F01',workouts:0,
      readOnly:true,productionMutated:false,trainerVerified:false,legacyRegistryMatched:false,retainedLoginBinding:false,
      reason:'additional_binding_requires_review',identityAuditVersion:1,retainedSourcesChecked:expect.any(Number) as unknown,
      retainedProfileCandidates:1,linkedTrainerCandidates:1,retainedBindingSources:['program_lookup_fixture']})
    expect(JSON.stringify(f.receipts)).not.toContain(f.coach)
    for(const mode of ['apply','verify'] as const)await expect(runProgramImport({...options,mode})).rejects.toThrow('current_trainer_identity_required')
    expect(f.started).toBe(false);expect(f.proof).toBeNull()
    expect(await f.count('clients')).toBe(0);expect(await f.count('workouts')).toBe(0)
  })
  it('includes an existing verified login-to-provider-subject mapping as readonly evidence',async()=>{
    const f=await fixture()
    await f.owner.query('delete from app_private.fit_lime_pilot_allowlist where profile_id=$1',[f.coach])
    await f.owner.query(`insert into app_private.corporate_admin_logins(login_sha256,subject_sha256,enabled)
      select $1,provider_subject_sha256,false from app_private.auth_identities where profile_id=$2 and provider='yandex'`,
    [f.options.target.trainerLoginSha256,f.coach])
    const options={...f.options,legacyId:null}
    expect(await runProgramImport(options)).toMatchObject({status:'identity_requires_review',trainerVerified:false,
      reason:'additional_binding_requires_review',retainedProfileCandidates:1,linkedTrainerCandidates:1,
      retainedBindingSources:['corporate_admin_logins']})
    expect(JSON.stringify(f.receipts)).not.toContain(f.coach)
    await expect(runProgramImport({...options,mode:'apply'})).rejects.toThrow('current_trainer_identity_required')
    expect(f.started).toBe(false);expect(await f.count('workouts')).toBe(0)
  })
  it('retains ambiguity across additional sources instead of guessing a trainer',async()=>{
    const f=await fixture()
    await f.owner.query('delete from app_private.fit_lime_pilot_allowlist where profile_id=$1',[f.coach])
    await f.owner.query('create table if not exists app_private.program_lookup_fixture(login_sha256 text,profile_id uuid)')
    await f.owner.query('insert into app_private.program_lookup_fixture values($1,$2),($3,$4)',
      [f.options.target.trainerLoginSha256,f.coach,f.options.target.trainerEmailSha256,f.other])
    expect(await runProgramImport({...f.options,legacyId:null})).toMatchObject({status:'identity_requires_review',
      trainerVerified:false,retainedProfileCandidates:2,linkedTrainerCandidates:1,readOnly:true,productionMutated:false})
    for(const id of [f.coach,f.other])expect(JSON.stringify(f.receipts)).not.toContain(id)
    expect(f.started).toBe(false);expect(f.proof).toBeNull();expect(await f.count('workouts')).toBe(0)
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
    const card=await f.card(f.name,f.coach,athlete),old=randomUUID(),foreign=randomUUID(),deleted=randomUUID(),packageId=randomUUID()
    await f.owner.query("insert into public.workouts(id,trainer_id,created_by,client_id,workout_date,status,completed_at,notes) values($1,$2,$2,$3,'2026-10-26','done',now(),'Keep old')",[old,f.coach,card])
    await f.owner.query("insert into public.workouts(id,trainer_id,created_by,client_id,workout_date,status,completed_at,notes,deleted_at) values($1,$2,$3,$4,'2025-01-01','done',now(),'Keep foreign history',null),($5,$2,$2,$4,'2025-01-02','done',now(),'Keep soft-deleted history',now())",[foreign,f.coach,f.other,card,deleted])
    await f.runtime.query('begin transaction read only')
    await f.runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[f.coach])
    expect((await f.runtime.query('select id from public.workouts where client_id=$1 order by id',[card])).rows).toEqual([{id:old}])
    await f.runtime.query('rollback')
    await f.owner.query("insert into public.trainer_finance_packages(id,trainer_id,client_id,title,sessions_total,price_cents,starts_on) values($1,$2,$3,'Keep package',10,50000,'2025-01-01')",[packageId,f.coach,card])
    await f.owner.query("insert into public.trainer_finance_payments(package_id,trainer_id,client_id,amount_cents,received_on) values($1,$2,$3,50000,'2025-01-01')",[packageId,f.coach,card])
    const before=(await f.owner.query('select to_jsonb(w) value from public.workouts w where id=any($1::uuid[]) order by id',[[old,foreign,deleted]])).rows
    const finances=async()=>Promise.all(['trainer_finance_packages','trainer_finance_payments'].map(async table=>(await f.owner.query<{value:unknown}>(`select to_jsonb(x) value from public.${table} x where client_id=$1 order by id`,[card])).rows))
    const financialBefore=await finances()
    await runProgramImport(f.options)
    expect(await runProgramImport({...f.options,mode:'apply'})).toMatchObject({createdCard:false,contentVerified:true,previousStateVerified:true})
    expect((await f.owner.query('select to_jsonb(w) value from public.workouts w where id=any($1::uuid[]) order by id',[[old,foreign,deleted]])).rows).toEqual(before)
    expect(await finances()).toEqual(financialBefore);expect(await f.count('workouts')).toBe(6)
    expect(await runProgramImport({...f.options,mode:'verify'})).toMatchObject({status:'verified',workouts:3,readOnly:true})
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
  it('verifies a pre-attendance receipt without backfilling historical sessions',async()=>{
    const f=await fixture();await runProgramImport(f.options)
    await expect(runProgramImport({...f.options,mode:'apply',persistReceipt:async(state,receipt)=>{
      await f.options.persistReceipt(state,receipt);if(state==='committed')throw Error('synthetic lost receipt reply')
    }})).rejects.toThrow('outcome_requires_readback')
    // Emulate a committed pre-182 packet and its original receipt, not a new write.
    delete f.proof!.financeAttendanceVersion
    await f.owner.query("delete from public.trainer_finance_sessions where trainer_id=$1 and disposition='unassigned' and package_id is null",[f.coach])
    expect(await runProgramImport({...f.options,mode:'verify'})).toMatchObject({status:'verified',readOnly:true,workouts:3})
    expect(await f.count('trainer_finance_sessions')).toBe(0)
    expect(await f.count('workouts')).toBe(3);expect(f.verified).toEqual(['complete'])
  })
  it('retains a later manual attendance decision and rejects changed finance during readback',async()=>{
    const f=await fixture();await runProgramImport(f.options)
    await expect(runProgramImport({...f.options,mode:'apply',persistReceipt:async(state,receipt)=>{
      await f.options.persistReceipt(state,receipt);if(state==='committed')throw Error('synthetic lost receipt reply')
    }})).rejects.toThrow('outcome_requires_readback')
    const session=(await f.owner.query<{id:string;version:string;workout_date:string}>(`select s.id,s.version::text version,w.workout_date::text workout_date
      from public.trainer_finance_sessions s join public.workouts w on w.id=s.workout_id
      where s.trainer_id=$1 order by s.id limit 1`,[f.coach])).rows[0]!
    await f.runtime.query('begin')
    await f.runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[f.coach])
    await f.runtime.query("select public.update_trainer_finance_session_details_v2($1,$2,'free',null,$3,$4::date)",
      [session.id,session.version,'Synthetic manual decision',session.workout_date])
    await f.runtime.query('commit')
    const rows=async()=>(await f.owner.query<{value:unknown}>('select to_jsonb(s) value from public.trainer_finance_sessions s where trainer_id=$1 order by id',[f.coach])).rows
    const before=await rows()
    await expect(runProgramImport({...f.options,mode:'verify'})).rejects.toThrow('finance_changed')
    expect(await rows()).toEqual(before);expect(await f.count('workouts')).toBe(3)
    expect(f.verified).toEqual([]);expect(f.receipts.at(-1)?.state).toBe('prepared')
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
