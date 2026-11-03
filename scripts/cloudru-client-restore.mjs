import {createHash, randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {readHistoryRegistry} from './cloudru-account-history-audit.mjs'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const sha=/^[a-f0-9]{64}$/
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const requireState=(condition,code)=>{if(!condition)throw Error(`client_restore_${code}`)}
const bounded=(rows,max)=>{requireState(Array.isArray(rows)&&rows.length<=max,'scope');return rows}

export function readRestoreTarget(raw){
 let value;try{value=JSON.parse(raw)}catch{throw Error('client_restore_target')}
 requireState(value&&Object.keys(value).sort().join(',')==='athleteEmailSha256,trainerEmailSha256'
   &&typeof value.athleteEmailSha256==='string'&&typeof value.trainerEmailSha256==='string'
   &&sha.test(value.athleteEmailSha256)&&sha.test(value.trainerEmailSha256)
   &&value.athleteEmailSha256!==value.trainerEmailSha256,'target')
 return value
}

export function resolveRestorePair(matches){
 const trainer=matches.filter(row=>row.label==='trainer'),athlete=matches.filter(row=>row.label==='athlete')
 requireState(trainer.length===1&&athlete.length===1&&uuid.test(trainer[0].id)&&uuid.test(athlete[0].id)
   &&trainer[0].id!==athlete[0].id,'identity_ambiguous')
 return {trainerId:trainer[0].id,athleteId:athlete[0].id}
}

async function ownerGate(client,write=false){
 const r=(await client.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
 requireState(r?.username==='fit_owner'&&r.readonly===(write?'off':'on'),'owner_gate')
 await client.query("set local statement_timeout='10s'")
 await client.query("set local lock_timeout='2s'")
}

export async function readRestoreState(client,pair){
 const profiles=bounded((await client.query(`select p.id,p.account_role,
   (select count(*)::int from app_private.auth_identities i where i.profile_id=p.id and i.provider='yandex') identities
   from public.profiles p where p.id=any($1::uuid[]) order by p.id`,[[pair.trainerId,pair.athleteId]])).rows,2)
 requireState(profiles.length===2&&profiles.some(p=>p.id===pair.trainerId&&p.account_role==='trainer')
   &&profiles.some(p=>p.id===pair.athleteId&&p.account_role==='client'),'role')
 const cards=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version
   from public.clients where auth_user_id=$1 and merged_into_client_id is null order by id limit 3`,[pair.athleteId])).rows,2)
 requireState(cards.length===1&&!cards[0].archived_at,'canonical')
 const card=cards[0]
 const sources=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version
   from public.clients where merged_into_client_id=$1 and trainer_id=$2 order by id limit 3`,[card.id,pair.trainerId])).rows,2)
 requireState(sources.length===1&&sources[0].auth_user_id===null,'source')
 const periods=bounded((await client.query(`select id,trainer_id,status,connected_at,disconnected_at,connected_by,disconnected_by,source_invitation_id,created_at,updated_at
   from public.client_trainer_relationships where client_id=$1 order by connected_at,id limit 101`,[card.id])).rows,100)
 const memberships=bounded((await client.query(`select client_id,trainer_id,version,
   encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') digest
   from public.client_trainers m where client_id=any($1::uuid[]) and trainer_id=$2 order by client_id`,[[card.id,sources[0].id],pair.trainerId])).rows,2)
 requireState(memberships.some(m=>m.client_id===sources[0].id),'source_membership')
 const history={}
 for(const table of ['workouts','workout_exercises','workout_sets']){
   const r=(await client.query(`select count(*)::int count,
     encode(sha256(convert_to(coalesce(string_agg(to_jsonb(item)::text,E'\\n' order by item.id),''),'UTF8')),'hex') digest
     from public.${table} item where client_id=any($1::uuid[])`,[[card.id,sources[0].id]])).rows[0]
   requireState(r&&Number.isSafeInteger(r.count)&&r.count<=(table==='workouts'?5000:50000),'scope')
   history[table]=r
 }
 const groups=(await client.query(`select client_id,status,deleted_at is not null deleted,count(*)::int count
   from public.workouts where client_id=any($1::uuid[]) group by client_id,status,deleted_at is not null
   order by client_id,status,deleted`,[[card.id,sources[0].id]])).rows
 requireState(groups.length===1&&groups[0].client_id===card.id&&groups[0].status==='done'
   &&groups[0].deleted===false&&groups[0].count>=21,'history')
 const merges=bounded((await client.query(`select id,status,created_at,completed_at,actor_id from public.client_merge_operations
   where source_client_id=$1 and target_client_id=$2 order by created_at,id limit 11`,[sources[0].id,card.id])).rows,10)
 const foundations=(await client.query(`select name,run_on from app_private.fit_migrations
   where name like '000149%' or name like '000150%' order by name limit 3`)).rows
 return {profiles,card,source:sources[0],periods,memberships,history,groups,merges,foundations}
}

function publicState(state,pair){
 const label=id=>id===pair.trainerId?'trainer':id===pair.athleteId?'historicalAthlete':id?'otherProfile':null
 const time=value=>value?new Date(value).toISOString():null
 return {done:state.groups[0].count,canonicalArchived:Boolean(state.card.archived_at),
   historicalAthleteYandexLinked:state.profiles.find(p=>p.id===pair.athleteId).identities>0,
   canonicalMembership:state.memberships.some(m=>m.client_id===state.card.id),
   activePeriods:state.periods.filter(p=>p.status==='active').length,
   periods:state.periods.map(p=>({trainer:label(p.trainer_id),status:p.status,connectedAt:time(p.connected_at),
     disconnectedAt:time(p.disconnected_at),createdAt:time(p.created_at),updatedAt:time(p.updated_at),
     connectedBy:label(p.connected_by),disconnectedBy:label(p.disconnected_by)})),
   merges:state.merges.map(m=>({status:m.status,createdAt:time(m.created_at),completedAt:time(m.completed_at),actor:label(m.actor_id)})),
   foundations:state.foundations.map(m=>({name:m.name,appliedAt:time(m.run_on)}))}
}

export async function planClientRestore(client,pair){
 await client.query('begin transaction isolation level repeatable read read only')
 try{
   await ownerGate(client)
   const state=await readRestoreState(client,pair)
   requireState(!state.periods.some(p=>p.status==='active'),'already_connected')
   requireState(state.periods.some(p=>p.trainer_id===pair.trainerId&&p.status==='disconnected'),'no_previous_period')
   await client.query('commit')
   // Kept only in a root-owned private plan file. No identifiers/fingerprints go to logs.
   return {schema:1,ticket:'YAFIT-701',createdAt:Date.now(),pair,periodId:randomUUID(),state,
     fingerprint:fingerprint(state),report:{event:'client_restore_plan',readOnly:true,...publicState(state,pair)}}
 }catch(error){await client.query('rollback');throw error}
}

export async function applyClientRestore(client,plan,{backupVerified=false}={}){
 requireState(plan?.schema===1&&plan.ticket==='YAFIT-701'&&uuid.test(plan.periodId)
   &&uuid.test(plan.pair?.trainerId)&&uuid.test(plan.pair?.athleteId)
   &&Number.isSafeInteger(plan.createdAt)&&Date.now()-plan.createdAt>=0
   &&Date.now()-plan.createdAt<=3600000&&fingerprint(plan.state)===plan.fingerprint,'plan')
 requireState(backupVerified,'backup_required')
 const {pair}=plan
 await client.query('begin transaction isolation level serializable read write')
 try{
   await ownerGate(client,true)
   await client.query("select pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||$1::text,0))",[pair.athleteId])
   await client.query('select id from public.clients where id=any($1::uuid[]) order by id for update',[[plan.state.card.id,plan.state.source.id]])
   await client.query('select client_id from public.client_trainers where client_id=any($1::uuid[]) and trainer_id=$2 order by client_id for update',[[plan.state.card.id,plan.state.source.id],pair.trainerId])
   const current=await readRestoreState(client,pair)
   const receipt=current.periods.find(p=>p.id===plan.periodId)
   if(receipt){
     requireState(receipt.status==='active'&&receipt.trainer_id===pair.trainerId,'restored_period_ended')
     requireState(current.periods.filter(p=>p.status==='active').length===1,'other_trainer')
     requireState(current.memberships.some(m=>m.client_id===current.card.id),'restored_membership_missing')
     requireState(fingerprint(current.history)===fingerprint(plan.state.history),'history_changed_since_restore')
     await client.query('commit')
     return {event:'client_restore_applied',replayed:true,historyUnchanged:true}
   }
   requireState(!current.periods.some(p=>p.status==='active'),'other_trainer')
   requireState(fingerprint(current)===plan.fingerprint,'state_changed')
   await client.query(`insert into public.client_trainers(client_id,trainer_id,joined_at,alias,note,attention_snoozed_until)
     select $1,$2,joined_at,alias,note,attention_snoozed_until from public.client_trainers
     where client_id=$3 and trainer_id=$2 on conflict(client_id,trainer_id) do nothing`,[current.card.id,pair.trainerId,current.source.id])
   // Explicit owner-authorized operational repair on behalf of this trainer,
   // recorded in the protected plan/receipt. No app-session or athlete consent is fabricated.
   await client.query(`insert into public.client_trainer_relationships(id,client_id,trainer_id,connected_by)
     values($1,$2,$3,$3)`,[plan.periodId,current.card.id,pair.trainerId])
   const after=await readRestoreState(client,pair)
   requireState(fingerprint(after.history)===fingerprint(current.history),'history_changed')
   requireState(fingerprint(after.card)===fingerprint(current.card)&&fingerprint(after.source)===fingerprint(current.source)
     &&fingerprint(after.profiles)===fingerprint(current.profiles)&&fingerprint(after.merges)===fingerprint(current.merges),'protected_state_changed')
   requireState(after.periods.length===current.periods.length+1&&current.periods.every(p=>
     after.periods.some(a=>fingerprint(a)===fingerprint(p)))&&after.periods.filter(p=>p.status==='active').length===1,'periods_changed')
   requireState(current.memberships.every(m=>after.memberships.some(a=>fingerprint(a)===fingerprint(m)))
     &&after.memberships.some(m=>m.client_id===current.card.id),'memberships_changed')
   // Pure permission reads under the trainer claim, never a fabricated session/write API.
   await client.query("select set_config('request.jwt.claim.sub',$1,true)",[pair.trainerId])
   const overview=(await client.query('select done_count from public.list_client_overviews(false) where id=$1',[current.card.id])).rows
   requireState(overview.length===1&&overview[0].done_count===current.groups[0].count,'visibility')
   await client.query('commit')
   return {event:'client_restore_applied',replayed:false,newPeriods:1,historyUnchanged:true,done:current.groups[0].count}
 }catch(error){await client.query('rollback');throw error}
}

export async function verifyClientRestore(runtime,plan){
 await runtime.query('begin transaction isolation level repeatable read read only')
 try{
   const role=(await runtime.query(`select current_user username,current_setting('transaction_read_only') readonly,
     rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
   requireState(role?.username==='fit_api'&&role.readonly==='on'&&!role.rolsuper&&!role.rolbypassrls,'runtime_role')
   await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[plan.pair.trainerId])
   const receipt=(await runtime.query(`select
     exists(select 1 from public.client_trainers where client_id=$1 and trainer_id=$2) membership,
     exists(select 1 from public.client_trainer_relationships where id=$3 and client_id=$1
       and trainer_id=$2 and status='active') period`,[plan.state.card.id,plan.pair.trainerId,plan.periodId])).rows[0]
   requireState(receipt?.membership&&receipt.period,'runtime_receipt')
   const rows=(await runtime.query('select done_count from public.list_client_overviews(false) where id=$1',[plan.state.card.id])).rows
   const count=(await runtime.query("select count(*)::int count from public.workouts where client_id=$1 and status='done' and deleted_at is null",[plan.state.card.id])).rows[0]?.count
   requireState(rows.length===1&&rows[0].done_count===plan.state.groups[0].count&&count===rows[0].done_count,'runtime_visibility')
   await runtime.query('commit')
   return {event:'client_restore_verified',readOnly:true,restoredPeriodActive:true,canonicalMembership:true,trainerCanReadCanonical:true,done:count}
 }catch(error){await runtime.query('rollback');throw error}
}

async function json(url,headers){
 const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)})
 requireState(r.ok,'registry');const chunks=[];let size=0
 for await(const chunk of r.body){size+=chunk.length;requireState(size<=5*1024*1024,'scope');chunks.push(chunk)}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function main(){
 requireState(process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_REPOSITORY==='podkolzinpd/fit','environment')
 const phase=process.env.RESTORE_PHASE,planPath='/repair/plan.json'
 requireState(['plan','apply','verify'].includes(phase),'phase')
 const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
 const {Client}=createRequire('/app/package.json')('pg')
 const config=buildDatabaseConnectionConfig(phase==='verify'?'DATABASE':'MIGRATION_DATABASE')
 requireState(config.host==='10.70.10.67'&&config.port===5432&&config.database==='fit'
   &&config.user===(phase==='verify'?'fit_api':'fit_owner')
   &&process.env[phase==='verify'?'DATABASE_SSL_MODE':'MIGRATION_DATABASE_SSL_MODE']==='require','environment')
 const client=new Client({...config,connectionTimeoutMillis:5000,query_timeout:15000});await client.connect()
 try{
   if(phase==='plan'){
     const target=readRestoreTarget(process.env.FIT_CLIENT_RESTORE_TARGETS),project=process.env.SUPABASE_PROJECT_ID
     requireState(/^[a-z0-9]{20}$/.test(project??''),'environment')
     const keys=await json(`https://api.supabase.com/v1/projects/${project}/api-keys`,{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`})
     const key=keys.find(k=>k.name==='service_role')?.api_key;requireState(typeof key==='string'&&key.length>0,'registry')
     const matches=await readHistoryRegistry(page=>json(`https://${project}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`,{Authorization:`Bearer ${key}`,apikey:key}),
       [{label:'trainer',role:'trainer',emailHash:target.trainerEmailSha256},{label:'athlete',role:'client',emailHash:target.athleteEmailSha256}])
     const plan=await planClientRestore(client,resolveRestorePair(matches));plan.requestedBy=process.env.GITHUB_ACTOR
     await writeFile(planPath,JSON.stringify(plan),{flag:'wx',mode:0o600});console.log(JSON.stringify(plan.report))
   }else{
     const plan=JSON.parse(await readFile(planPath,'utf8'))
     const result=phase==='apply'?await applyClientRestore(client,plan,{backupVerified:process.env.RESTORE_BACKUP_VERIFIED==='true'}):await verifyClientRestore(client,plan)
     await writeFile(`/repair/${phase}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`,JSON.stringify({at:new Date().toISOString(),operator:process.env.GITHUB_ACTOR,result}),{flag:'wx',mode:0o600})
     console.log(JSON.stringify(result))
   }
 }finally{await client.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 console.error(/^client_restore_[a-z_]+$/.test(error?.message)?error.message:'client_restore_failed');process.exitCode=1
})
