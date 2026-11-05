import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {readHistoryTargets,readHistoryRegistry,readHistoryEvidenceSecret,resolveHistoryEvidence} from './cloudru-account-history-audit.mjs'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const need=(condition,code)=>{if(!condition)throw Error(`athlete_restore_${code}`)}
const bound=(rows,max)=>{need(Array.isArray(rows)&&rows.length<=max,'scope');return rows}
const quote=value=>{need(/^[a-z_][a-z0-9_]*$/.test(value),'catalog');return '"'+value+'"'}
const metadata=new Set(['app_feedback','user_legal_acceptances','notification_preferences','push_subscriptions',
  'trainer_discovery_prompt_preferences','client_invitations','client_trainers','client_trainer_relationships','client_merge_operations'])

async function gate(client,write=false){
 const r=(await client.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
 need(r?.username==='fit_owner'&&r.readonly===(write?'off':'on'),'owner_gate')
 await client.query("set local statement_timeout='10s'")
 await client.query("set local lock_timeout='2s'")
}

// Every profile FK plus conventional logical owner column is inventoried.
// Raw rows never leave PostgreSQL; private plans retain only bounded digests.
export async function profileReferences(client,ids,cardIds){
 const tables=bound((await client.query(`select n.nspname schema,c.relname name,
   array_agg(distinct a.attname::text order by a.attname::text) columns,
   exists(select 1 from pg_attribute x where x.attrelid=c.oid and x.attname='client_id' and not x.attisdropped) has_client,
   exists(select 1 from pg_attribute x where x.attrelid=c.oid and x.attname in('owner_id','user_id','client_user_id') and not x.attisdropped) private_owner
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid and a.atttypid='uuid'::regtype and not a.attisdropped and a.attnum>0
   where n.nspname in('public','app_private') and c.relkind='r' and c.relname not in('profiles','clients')
   and (a.attname in('owner_id','user_id','profile_id','auth_user_id','client_user_id') or exists(
     select 1 from pg_constraint fk where fk.contype='f' and fk.conrelid=c.oid
       and fk.confrelid in('public.profiles'::regclass,'public.trainers'::regclass) and a.attnum=any(fk.conkey)))
   group by n.nspname,c.relname,c.oid order by n.nspname,c.relname limit 101`)).rows,100)
 const result=[]
 for(const t of tables){
  need(Array.isArray(t.columns)&&t.columns.length>0&&t.columns.length<=20,'catalog')
  const table=quote(t.schema)+'.'+quote(t.name)
  const predicate=t.columns.map(c=>`r.${quote(c)}=any($1::uuid[])`).join(' or ')
  const old=t.columns.map(c=>`r.${quote(c)}=$2::uuid`).join(' or ')
  const stats=(await client.query(`select count(*)::int count,count(*) filter(where ${old})::int legacy,
    coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint bytes from ${table} r where ${predicate}`,[ids,ids[0]])).rows[0]
  need(stats&&stats.count<=50000&&Number(stats.bytes)<=20*1024*1024,'scope')
  const hash=(await client.query(`select encode(sha256(convert_to(coalesce(string_agg(j,E'\n' order by j),''),'UTF8')),'hex') digest
    from (select to_jsonb(r)::text j from ${table} r where ${predicate}) s`,[ids])).rows[0].digest
  let covered=t.schema==='app_private'||metadata.has(t.name)
  if(!covered&&t.has_client&&!t.private_owner){
   covered=(await client.query(`select count(*)::int count from ${table} r where (${predicate}) and (${old})
     and (r.client_id is null or not r.client_id=any($3::uuid[]))`,[ids,ids[0],cardIds])).rows[0].count===0
  }
  result.push({schema:t.schema,table:t.name,count:stats.count,legacy:stats.legacy,digest:hash,covered})
 }
 return result
}

// Includes coach-owned progress, goals and finances even when they contain no
// direct reference to either athlete profile. All snapshots remain private.
async function cardReferences(client,ids){
 const tables=bound((await client.query(`select n.nspname schema,c.relname name from pg_class c
   join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
   where n.nspname in('public','app_private') and c.relkind='r' and a.attname='client_id'
   and a.atttypid='uuid'::regtype and not a.attisdropped order by n.nspname,c.relname limit 101`)).rows,100)
 const result=[]
 for(const t of tables){
  const table=quote(t.schema)+'.'+quote(t.name)
  const stats=(await client.query(`select count(*)::int count,coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint bytes
    from ${table} r where client_id=any($1::uuid[])`,[ids])).rows[0]
  need(stats.count<=50000&&Number(stats.bytes)<=20*1024*1024,'scope')
  const hash=(await client.query(`select encode(sha256(convert_to(coalesce(string_agg(j,E'\n' order by j),''),'UTF8')),'hex') digest
    from (select to_jsonb(r)::text j from ${table} r where client_id=any($1::uuid[])) s`,[ids])).rows[0].digest
  result.push({schema:t.schema,table:t.name,count:stats.count,digest:hash})
 }
 return result
}

export async function readAthleteState(client,pair){
 need(pair&&['legacyId','currentId','trainerId'].every(k=>uuid.test(pair[k]??''))&&new Set(Object.values(pair)).size===3,'pair')
 const profiles=bound((await client.query(`select p.id,p.account_role,
   encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') digest,
   (select count(*)::int from app_private.auth_identities i where i.profile_id=p.id and i.provider='yandex') identities,
   (select i.identity_origin from app_private.auth_identities i where i.profile_id=p.id and i.provider='yandex') origin
   from public.profiles p where p.id=any($1::uuid[]) order by p.id`,[[pair.legacyId,pair.currentId,pair.trainerId]])).rows,3)
 need(profiles.length===3&&profiles.some(p=>p.id===pair.legacyId&&p.account_role==='client'&&p.identities===0)
   &&profiles.some(p=>p.id===pair.currentId&&p.account_role==='client'&&p.identities===1&&p.origin==='native')
   &&profiles.some(p=>p.id===pair.trainerId&&p.account_role==='trainer'),'profile_proof')
 const owners=bound((await client.query(`select * from public.clients where auth_user_id=any($1::uuid[])
   and merged_into_client_id is null order by id limit 3`,[[pair.legacyId,pair.currentId]])).rows,2)
 need(owners.length===1&&!owners[0].archived_at,'canonical')
 const card=owners[0]
 need([pair.legacyId,pair.currentId].includes(card.auth_user_id),'canonical')
 const cards=bound((await client.query('select * from public.clients where id=$1 or merged_into_client_id=$1 order by id limit 11',[card.id])).rows,10)
 need(cards.every(c=>c.id===card.id||c.auth_user_id===null),'source_claimed')
 const cardIds=cards.map(c=>c.id)
 const periods=bound((await client.query('select * from public.client_trainer_relationships where client_id=any($1::uuid[]) order by id limit 101',[cardIds])).rows,100)
 const active=periods.filter(r=>r.status==='active')
 need(active.length===1&&active[0].client_id===card.id&&active[0].trainer_id===pair.trainerId,'trainer_connection')
 const memberships=bound((await client.query('select * from public.client_trainers where client_id=any($1::uuid[]) order by client_id,trainer_id limit 101',[cardIds])).rows,100)
 need(memberships.some(r=>r.client_id===card.id&&r.trainer_id===pair.trainerId),'trainer_membership')
 const auth=(await client.query(`select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\n' order by to_jsonb(i)::text),''),'UTF8')),'hex') digest
   from app_private.auth_identities i where profile_id=any($1::uuid[])`,[[pair.legacyId,pair.currentId]])).rows[0]
 const sessions=(await client.query(`select count(*) filter(where profile_id=$1 and revoked_at is null and expires_at>now())::int old_active
   from app_private.yandex_app_sessions where profile_id=any($2::uuid[])`,[pair.legacyId,[pair.legacyId,pair.currentId]])).rows[0]
 need(sessions.old_active===0,'legacy_session_active')
 const deletions=(await client.query(`select count(*)::int count from public.account_deletion_requests
   where user_id=any($1::uuid[]) and status='requested'`,[[pair.legacyId,pair.currentId]])).rows[0]
 need(deletions.count===0,'deletion_pending')
 const history={}
 for(const table of ['workouts','workout_exercises','workout_sets']){
  const stats=(await client.query(`select count(*)::int count,coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint bytes
    from public.${table} r where client_id=any($1::uuid[])`,[cardIds])).rows[0]
  need(stats.count<=50000&&Number(stats.bytes)<=20*1024*1024,'scope')
  const rows=(await client.query(`select count(*)::int count,
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by id),''),'UTF8')),'hex') digest,
    coalesce(jsonb_agg(id order by id),'[]'::jsonb) ids from public.${table} r where client_id=any($1::uuid[])`,[cardIds])).rows[0]
  history[table]=rows
 }
 need(history.workouts.count>0,'empty_history')
 const groups=(await client.query(`select status,deleted_at is not null deleted,count(*)::int count from public.workouts
   where client_id=any($1::uuid[]) group by status,deleted_at is not null order by status,deleted`,[cardIds])).rows
 const references=await profileReferences(client,[pair.legacyId,pair.currentId],cardIds)
 const cardData=await cardReferences(client,cardIds)
 return {profiles,cards,card,periods,memberships,auth,history,groups,references,cardData}
}

function protectedState(state){
 const clean=c=>{const {auth_user_id:_owner,version:_version,updated_at:_updated,...rest}=c;return rest}
 return {...state,card:clean(state.card),cards:state.cards.map(c=>c.id===state.card.id?clean(c):c)}
}
export async function planAthleteRestore(client,pair){
 await client.query('begin transaction isolation level repeatable read read only')
 try{
  await gate(client);const state=await readAthleteState(client,pair)
  need(state.card.auth_user_id===pair.legacyId,'already_restored')
  const uncovered=state.references.filter(r=>r.legacy>0&&!r.covered)
  const plan={schema:1,ticket:'YAFIT-646',createdAt:Date.now(),pair,state,fingerprint:digest(state),ready:uncovered.length===0}
  await client.query('commit')
  return {...plan,report:{event:'athlete_access_plan',readOnly:true,repairReady:plan.ready,
    workouts:state.groups,protectedTables:state.references.length,
    uncoveredOldData:uncovered.map(r=>({table:r.table,count:r.legacy})),newProfileDataPreserved:true}}
 }catch(e){await client.query('rollback');throw e}
}

export async function applyAthleteRestore(client,plan,{backupVerified=false}={}){
 need(backupVerified,'backup_required')
 need(plan?.schema===1&&plan.ticket==='YAFIT-646'&&plan.ready===true&&digest(plan.state)===plan.fingerprint
   &&Number.isSafeInteger(plan.createdAt)&&Date.now()-plan.createdAt>=0&&Date.now()-plan.createdAt<=3600000,'plan')
 await client.query('begin transaction isolation level serializable read write')
 try{
  await gate(client,true)
  for(const id of [plan.pair.legacyId,plan.pair.currentId].sort())await client.query("select pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||$1::text,0))",[id])
  await client.query('select id from public.profiles where id=any($1::uuid[]) order by id for update',[[plan.pair.legacyId,plan.pair.currentId]])
  await client.query('select id from public.clients where id=any($1::uuid[]) order by id for update',[plan.state.cards.map(c=>c.id)])
  const before=await readAthleteState(client,plan.pair)
  if(before.card.auth_user_id===plan.pair.currentId){
   need(digest(protectedState(before))===digest(protectedState(plan.state)),'replay_state_changed')
   await client.query('commit');return {event:'athlete_access_applied',replayed:true,historyUnchanged:true}
  }
  need(digest(before)===plan.fingerprint,'state_changed')
  need(before.references.every(r=>r.legacy===0||r.covered),'old_private_data')
  const changed=(await client.query(`update public.clients set auth_user_id=$1,version=version+1
    where id=$2 and auth_user_id=$3 and version=$4 returning id`,
  [plan.pair.currentId,before.card.id,plan.pair.legacyId,before.card.version])).rows
  need(changed.length===1,'card_changed')
  const after=await readAthleteState(client,plan.pair)
  need(after.card.auth_user_id===plan.pair.currentId&&BigInt(after.card.version)===BigInt(before.card.version)+1n,'card_postcondition')
  need(digest(protectedState(after))===digest(protectedState(before)),'protected_state_changed')
  await client.query('commit')
  return {event:'athlete_access_applied',replayed:false,changedCards:1,historyUnchanged:true,identityAndCurrentProfileUnchanged:true}
 }catch(e){await client.query('rollback');throw e}
}

export async function verifyAthleteRestore(runtime,plan,{readProfile}={}){
 await runtime.query('begin transaction isolation level repeatable read read only')
 try{
  const role=(await runtime.query(`select current_user username,current_setting('transaction_read_only') readonly,
    rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
  need(role?.username==='fit_api'&&role.readonly==='on'&&!role.rolsuper&&!role.rolbypassrls,'runtime_role')
  need(typeof readProfile==='function','profile_reader_required')
  for(const actor of [plan.pair.currentId,plan.pair.trainerId]){
   await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[actor])
   if(actor===plan.pair.currentId){
    const own=await readProfile()
    need(own?.profile.id===plan.pair.currentId&&own.profile.client?.id===plan.state.card.id,'runtime_own_profile')
   }
   const card=(await runtime.query('select auth_user_id,archived_at,merged_into_client_id from public.clients where id=$1',[plan.state.card.id])).rows
   need(card.length===1&&card[0].auth_user_id===plan.pair.currentId&&!card[0].archived_at&&!card[0].merged_into_client_id,'runtime_card')
   for(const table of ['workouts','workout_exercises','workout_sets']){
    const count=(await runtime.query(`select count(*)::int count from public.${table} where id=any($1::uuid[])`,[plan.state.history[table].ids])).rows[0].count
    need(count===plan.state.history[table].count,'runtime_history')
   }
  }
  await runtime.query('commit')
  return {event:'athlete_access_verified',readOnly:true,athleteCanReadHistory:true,trainerCanReadHistory:true,
    preservedWorkouts:plan.state.history.workouts.count,currentLoginUnchanged:true}
 }catch(e){await runtime.query('rollback');throw e}
}

async function sourceJson(url,headers){
 const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)})
 need(r.ok,'registry');let size=0;const chunks=[]
 for await(const c of r.body){size+=c.length;need(size<=5*1024*1024,'scope');chunks.push(c)}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function main(){
 need(process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_REPOSITORY==='podkolzinpd/fit','environment')
 const phase=process.env.RESTORE_PHASE;need(['plan','apply','verify'].includes(phase),'phase')
 const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
 const {Client}=createRequire('/app/package.json')('pg')
 const prefix=phase==='verify'?'DATABASE':'MIGRATION_DATABASE',config=buildDatabaseConnectionConfig(prefix)
 need(config.host==='10.70.10.67'&&config.port===5432&&config.database==='fit'
  &&config.user===(phase==='verify'?'fit_api':'fit_owner')&&process.env[prefix+'_SSL_MODE']==='require','environment')
 const client=new Client({...config,connectionTimeoutMillis:5000,query_timeout:15000});await client.connect()
 try{
  if(phase==='plan'){
   const targets=readHistoryTargets(process.env.FIT_ACCOUNT_HISTORY_TARGETS),project=process.env.SUPABASE_PROJECT_ID
   need(/^[a-z0-9]{20}$/.test(project??''),'environment')
   const keys=await sourceJson(`https://api.supabase.com/v1/projects/${project}/api-keys`,{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`})
   const key=keys.find(k=>k.name==='service_role')?.api_key;need(typeof key==='string'&&key.length>20,'registry')
   const matches=await readHistoryRegistry(page=>sourceJson(`https://${project}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`,{Authorization:`Bearer ${key}`,apikey:key}),targets)
   const legacy=matches.filter(r=>r.label==='athleteLegacy'),trainer=matches.filter(r=>r.label==='trainerLegacy')
   need(legacy.length===1&&trainer.length===1,'registry')
   await client.query('begin transaction read only');await gate(client)
   let current;try{current=await resolveHistoryEvidence(client,readHistoryEvidenceSecret(process.env.FIT_ACCOUNT_HISTORY_EVIDENCE));await client.query('commit')}
   catch(e){await client.query('rollback');throw e}
   need(current&&current.kinds.includes('feedback'),'fresh_feedback_required')
   const plan=await planAthleteRestore(client,{legacyId:legacy[0].id,currentId:current.profileId,trainerId:trainer[0].id})
   await writeFile('/repair/plan.json',JSON.stringify(plan),{flag:'wx',mode:0o600});console.log(JSON.stringify(plan.report))
  }else{
   const plan=JSON.parse(await readFile('/repair/plan.json','utf8'))
   const {readOwnProfile}=phase==='verify'?await import('/app/dist/profile.js'):{}
   const profileReader={query:async(text,values)=>(await client.query(text,values)).rows}
   console.log(JSON.stringify(phase==='apply'?await applyAthleteRestore(client,plan,{backupVerified:process.env.RESTORE_BACKUP_VERIFIED==='true'}):await verifyAthleteRestore(client,plan,{readProfile:()=>readOwnProfile(profileReader)})))
  }
 }finally{await client.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(e=>{const allowed=/^athlete_restore_(owner_gate|scope|catalog|pair|profile_proof|canonical|source_claimed|trainer_connection|trainer_membership|legacy_session_active|deletion_pending|empty_history|already_restored|backup_required|plan|replay_state_changed|state_changed|old_private_data|card_changed|card_postcondition|protected_state_changed|runtime_role|runtime_card|runtime_history|runtime_own_profile|profile_reader_required|registry|environment|phase|fresh_feedback_required)$/
  console.error(allowed.test(e?.message??'')?e.message:'athlete_restore_failed');process.exitCode=1})
}
