import {createHash,randomUUID} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {fileURLToPath} from 'node:url'
import {Pool,type PoolClient,type QueryResultRow} from 'pg'
import {runner} from 'node-pg-migrate'
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest'
import {inspectProgramHistory} from '../../../../scripts/cloudru-program-history-inspect.mjs'
import {readSavePlannedWorkoutRequest} from '../planned-workout-request.js'
import {saveCompletedWorkout} from '../workout-commands.js'

const source=process.env.TEST_DATABASE_URL
const database=`fit_program_history_${process.pid}`
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
describe.skipIf(source===undefined)('private weekly-program read-only inventory and real actor visibility',{concurrent:false},()=>{
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
  async function fixture({linked=true,format='with_trainer',code='F01'}={}) {
    const owner=await pool.connect(),runtime=await pool.connect();connections.push(owner,runtime)
    await runtime.query('set role fit_api')
    const coach=randomUUID(),other=randomUUID(),login=hash(`synthetic-program-${coach}`)
    await owner.query("insert into public.profiles(id,account_role) values($1,'trainer'),($2,'trainer')",[coach,other])
    await owner.query('insert into public.trainers(profile_id) values($1),($2)',[coach,other])
    await owner.query('insert into app_private.fit_lime_pilot_allowlist(login_sha256,profile_id,enabled) values($1,$2,true)',[login,coach])
    if(linked)await owner.query("insert into app_private.auth_identities(provider,provider_subject_sha256,profile_id,identity_origin) values('yandex',$1,$2,'native')",[hash(`synthetic-subject-${coach}`),coach])
    const name='Тестовая Спортсменка',data={schemaVersion:4,code,batchId:`program-history-20261103-${code.toLowerCase()}`,clientName:name,matchNames:[name,'Спортсменка Тестовая'],workouts:[{
      requestId:randomUUID(),workoutDate:'2026-10-26',startTime:null,endTime:null,actualDurationSec:null,trainingFormat:format,notes:'Synthetic historical source',title:'Synthetic program',
      exercises:[{position:0,source:'system',ref:'snapshot:synthetic-program',customExerciseId:null,name:'Synthetic movement',muscleGroup:'other',inputKind:'strength',blockId:randomUUID(),blockType:'single',blockPreset:'set',blockRounds:1,restBetweenExercisesSec:0,restBetweenRoundsSec:0,restBetweenSetsSec:0,trainerComment:'Synthetic source',sets:[]}],
    }]}
    const raw=JSON.stringify(data),approvedSha256=hash(raw),encoded=gzipSync(raw).toString('base64'),split=Math.ceil(encoded.length/2)
    const receipts:Record<string,unknown>[]=[]
    const options={owner,runtime,legacyId:coach,target:{trainerLoginSha256:login,trainerEmailSha256:hash(`synthetic-email-${coach}`),clientNameSha256:hash(name)},
      parts:[encoded.slice(0,split),encoded.slice(split)],approvedSha256,readRequest:readSavePlannedWorkoutRequest,
      scopes:[{code,sha256:approvedSha256,workouts:1,exercises:1,sets:0,from:'2026-10-26',to:'2026-10-26',trainingFormat:format}],
      persistInspection:(receipt:Record<string,unknown>)=>{receipts.push(receipt);return Promise.resolve()}}
    async function card(fullName=name,trainerId=coach,archived=false) {
      const id=randomUUID();await owner.query('insert into public.clients(id,trainer_id,full_name,archived_at) values($1,$2,$3,$4)',[id,trainerId,fullName,archived?'2026-01-01':null]);return id
    }
    return {owner,runtime,coach,other,name,options,receipts,card,data}
  }
  async function rosterEvidence(f:Awaited<ReturnType<typeof fixture>>,self=false) {
    const first=await f.card(),names=[f.name]
    if(self)await f.owner.query('update public.clients set auth_user_id=$1,trainer_id=$2 where id=$3',[f.coach,f.other,first])
    for(let i=1;i<17;i++){const name=`Synthetic roster ${f.coach} ${i}`;names.push(name);await f.card(name)}
    await f.owner.query('delete from app_private.fit_lime_pilot_allowlist where profile_id=$1',[f.coach])
    // Migrations run as postgres in this disposable fixture; emulate their production owner only for the readonly connection.
    await f.owner.query("do $$ begin perform pg_advisory_xact_lock(193635,2);if not exists(select 1 from pg_roles where rolname='fit_owner') then create role fit_owner;comment on role fit_owner is 'private-program-roster-fixture-20261105';elsif not exists(select 1 from pg_roles r where r.rolname='fit_owner' and shobj_description(r.oid,'pg_authid')='private-program-roster-fixture-20261105') then raise exception 'foreign_fixture_owner_role';end if;end $$;alter role fit_owner bypassrls;grant usage on schema public,app_private to fit_owner;grant select on all tables in schema public,app_private to fit_owner;grant execute on function public.is_active_client_trainer_connection(uuid,uuid) to fit_owner;grant execute on function public.can_read_workout(uuid) to fit_owner")
    const target=f.options.target
    return {first,evidence:{version:1,targetBinding:hash(JSON.stringify([target.trainerEmailSha256,target.trainerLoginSha256,target.clientNameSha256])),
      rosterNameHashes:names.map(n=>hash(n.toLowerCase().replaceAll('ё','е')))}}
  }
  it('resolves the full current roster without email binding through fit_owner and independently verifies actual actor visibility',async()=>{
    const f=await fixture(),r=await rosterEvidence(f)
    await f.owner.query('set role fit_owner')
    expect(await inspectProgramHistory({...f.options,legacyId:null,trainerEvidence:r.evidence})).toMatchObject({status:'existing_ready',exactCards:1,newWorkouts:1})
    expect(f.receipts[0]).toMatchObject({trainerId:f.coach,selected:{id:r.first},identityEvidence:{method:'current_roster',matchedCards:17,sourcesAgree:true}})
  })
  it('keeps an archived predecessor in the receipt while selecting only its roster-proven current card',async()=>{
    const f=await fixture(),r=await rosterEvidence(f),old=await f.card(f.name,f.coach,true)
    await f.owner.query('update public.clients set merged_into_client_id=$1 where id=$2',[r.first,old])
    await f.owner.query('set role fit_owner')
    expect(await inspectProgramHistory({...f.options,legacyId:null,trainerEvidence:r.evidence})).toMatchObject({status:'existing_ready',exactCards:2})
    expect(f.receipts[0]).toMatchObject({selected:{id:r.first}})
    expect((f.receipts[0]?.candidates as {id:string}[]).map(c=>c.id).sort()).toEqual([r.first,old].sort())
    await f.owner.query('reset role')
    await f.owner.query('update public.clients set merged_into_client_id=null where id=$1',[old])
    await f.owner.query('set role fit_owner')
    expect(await inspectProgramHistory({...f.options,legacyId:null,trainerEvidence:r.evidence})).toMatchObject({status:'selection_requires_review'})
  })
  it('recognizes the trainers own authenticated card without a second auth account or another trainer relationship',async()=>{
    const f=await fixture({format:'self'}),r=await rosterEvidence(f,true)
    const before=(await f.owner.query('select to_jsonb(p) value from public.profiles p order by id')).rows
    await f.owner.query('set role fit_owner')
    expect(await inspectProgramHistory({...f.options,legacyId:null,trainerEvidence:r.evidence})).toMatchObject({status:'existing_ready',exactCards:1})
    expect(f.receipts[0]).toMatchObject({selected:{id:r.first,auth_user_id:f.coach,trainer_id:f.other}})
    expect((await f.owner.query('select to_jsonb(p) value from public.profiles p order by id')).rows).toEqual(before)
  })
  it.each(['duplicate','archived','conflicting_binding'])('rejects %s as roster import evidence',async cause=>{
      const f=await fixture(),r=await rosterEvidence(f)
      if(cause==='duplicate')await f.card()
      if(cause==='archived')await f.owner.query('update public.clients set archived_at=now() where id=$1',[r.first])
      if(cause==='conflicting_binding')await f.owner.query('insert into app_private.fit_lime_pilot_allowlist(login_sha256,profile_id,enabled) values($1,$2,true)',[f.options.target.trainerLoginSha256,f.other])
      await f.owner.query('set role fit_owner')
      await expect(inspectProgramHistory({...f.options,legacyId:null,trainerEvidence:r.evidence})).rejects.toThrow(cause==='conflicting_binding'?'sources_disagree':cause==='archived'?'trainer_ambiguous':'roster_changed')
      expect(f.receipts).toHaveLength(0)
  })
  it('matches a separate approved F13 spelling without editing packet aliases and still rejects multiple matching cards',async()=>{
    const f=await fixture({code:'F13'}),r=await rosterEvidence(f),canonical=f.name.slice(0,-1)+'я'
    await f.owner.query('update public.clients set full_name=$1 where id=$2',[canonical,r.first])
    r.evidence.rosterNameHashes[0]=hash(canonical.toLowerCase())
    const trainerEvidence={...r.evidence,programAlias:{code:'F13',sourceNameSha256:hash(f.name.toLowerCase()),rosterNameSha256:r.evidence.rosterNameHashes[0]}}
    await f.owner.query('set role fit_owner')
    expect(await inspectProgramHistory({...f.options,legacyId:null,trainerEvidence})).toMatchObject({status:'existing_ready',exactCards:1})
    expect(f.receipts[0]).toMatchObject({selected:{id:r.first},identityEvidence:{sourceAliasVerified:true}})
    await f.owner.query('reset role');await f.card(canonical);await f.owner.query('set role fit_owner')
    await expect(inspectProgramHistory({...f.options,legacyId:null,trainerEvidence})).rejects.toThrow('roster_changed')
  })
  it('finds a new card only within the verified trainer; no business writes or account changes',async()=>{
    const f=await fixture();await f.card(f.name,f.other)
    const before=(await f.owner.query('select to_jsonb(p) value from public.profiles p order by id')).rows
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'new_card_ready',readOnly:true,productionMutated:false,newWorkouts:1,exactCards:0})
    expect((await f.owner.query('select to_jsonb(p) value from public.profiles p order by id')).rows).toEqual(before)
    expect((await f.owner.query<{n:number}>('select count(*)::int n from public.clients where trainer_id=$1',[f.coach])).rows[0]?.n).toBe(0)
    expect(f.receipts[0]).toMatchObject({kind:'program_history_inspection',readOnly:true})
  })
  it('matches both Cyrillic operands in SQL under C locale and verifies actual RLS visibility',async()=>{
    const f=await fixture(),id=await f.card('Спортсменка Тестовая')
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'existing_ready',exactCards:1,existingWorkouts:0})
    expect(f.receipts[0]).toMatchObject({selected:{id,trainer_id:f.coach}})
  })
  it('holds ambiguous, archived and partial-name candidates instead of creating duplicates',async()=>{
    const f=await fixture();await f.card('Тестовая')
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'selection_requires_review',potentialCards:1,exactCards:0})
    await f.card(f.name,f.coach,true)
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'selection_requires_review',exactCards:1})
    await f.card()
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'selection_requires_review',exactCards:2})
  })
  it('requires a linked Yandex trainer and refuses a different identity binding',async()=>{
    const f=await fixture({linked:false})
    await expect(inspectProgramHistory(f.options)).rejects.toThrow('current_trainer_identity_required')
    await expect(inspectProgramHistory({...f.options,legacyId:f.other})).rejects.toThrow('trainer_ambiguous')
    expect(f.receipts).toHaveLength(0)
  })
  it('retains self format and trainer role without creating an authentication account',async()=>{
    const f=await fixture({format:'self'});await f.card()
    const before=(await f.owner.query('select count(*)::int n from app_private.auth_identities')).rows
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'existing_ready',readOnly:true})
    expect((await f.owner.query<{account_role:string}>('select account_role from public.profiles where id=$1',[f.coach])).rows[0]?.account_role).toBe('trainer')
    expect((await f.owner.query('select count(*)::int n from app_private.auth_identities')).rows).toEqual(before)
  })
  it('fails closed for an owner runtime and for unavailable encrypted readback storage',async()=>{
    const f=await fixture();await f.card()
    await expect(inspectProgramHistory({...f.options,runtime:f.owner})).rejects.toThrow('runtime_role_invalid')
    await expect(inspectProgramHistory({...f.options,persistInspection:()=>Promise.reject(Error('synthetic storage unavailable'))})).rejects.toThrow('synthetic storage unavailable')
    expect((await f.owner.query<{n:number}>('select count(*)::int n from public.workouts where trainer_id=$1',[f.coach])).rows[0]?.n).toBe(0)
  })
  it('reads real completed graphs, holds duplicates/changed source facts and preserves finances',async()=>{
    const f=await fixture(),id=await f.card()
    const parsed=readSavePlannedWorkoutRequest({...f.data.workouts[0],clientId:id},null)
    if(!parsed)throw Error('synthetic_draft_required')
    await f.runtime.query('begin')
    await f.runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[f.coach])
    await saveCompletedWorkout({query:async <Row extends QueryResultRow>(sql:string,args?:readonly unknown[])=>(await f.runtime.query<Row>(sql,args===undefined?undefined:[...args])).rows},parsed.draft,null)
    await f.runtime.query('commit')
    const before=(await f.owner.query('select to_jsonb(s) value from public.trainer_finance_sessions s where client_id=$1',[id])).rows
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'duplicates_require_manifest_review',duplicates:1,newWorkouts:0,existingWorkouts:1})
    await f.owner.query("update public.workout_exercises set trainer_comment='Changed synthetic source' where workout_id in(select id from public.workouts where client_id=$1)",[id])
    expect(await inspectProgramHistory(f.options)).toMatchObject({status:'history_requires_review',conflicts:1,duplicates:0})
    expect((await f.owner.query('select to_jsonb(s) value from public.trainer_finance_sessions s where client_id=$1',[id])).rows).toEqual(before)
  })
})
