import {createHash, randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const requireState=(condition,code)=>{if(!condition)throw Error(`client_restore_${code}`)}
const bounded=(rows,max)=>{requireState(Array.isArray(rows)&&rows.length<=max,'scope');return rows}
export function privateRestoreTechnicalResult(result){
 const allowed=new Set(['event','readOnly','replayed','newPeriods','historyUnchanged','restoredPeriodActive',
   'canonicalMembership','trainerCanReadCanonical','athleteCanReadCanonical','athleteCanReadTrainer','bothCanReadImported'])
 return Object.fromEntries(Object.entries(result).filter(([key])=>allowed.has(key)))
}

export function readRestoreTarget(raw){
 let value;try{value=JSON.parse(raw)}catch{throw Error('client_restore_target')}
 requireState(value&&Object.keys(value).sort().join(',')==='athleteProfileId,trainerProfileId'
   &&typeof value.athleteProfileId==='string'&&typeof value.trainerProfileId==='string'
   &&uuid.test(value.athleteProfileId)&&uuid.test(value.trainerProfileId)
   &&value.athleteProfileId!==value.trainerProfileId,'target')
 return {trainerId:value.trainerProfileId,athleteId:value.athleteProfileId}
}

async function ownerGate(client,write=false){
 const r=(await client.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
 requireState(r?.username==='fit_owner'&&r.readonly===(write?'off':'on'),'owner_gate')
 await client.query("set local statement_timeout='10s'")
 await client.query("set local lock_timeout='2s'")
}

export function readExpectedRestoreHistory(value){
 requireState(value&&Object.keys(value).sort().join(',')==='clientId,exercises,sets,workoutIds,workouts'
   &&uuid.test(value.clientId)&&Array.isArray(value.workoutIds)&&value.workoutIds.length>=1&&value.workoutIds.length<=5000
   &&value.workoutIds.every(id=>typeof id==='string'&&uuid.test(id))
   &&new Set(value.workoutIds).size===value.workoutIds.length&&value.workouts===value.workoutIds.length
   &&Number.isSafeInteger(value.exercises)&&value.exercises>=1&&value.exercises<=50000
   &&Number.isSafeInteger(value.sets)&&value.sets>=1&&value.sets<=100000,'expected_history')
 return value
}

export function readCurrentProfileEvidence(value,now=Date.now()){
 requireState(value&&Object.keys(value).sort().join(',')==='messageSha256,since'
   &&typeof value.messageSha256==='string'&&/^[a-f0-9]{64}$/u.test(value.messageSha256)
   &&typeof value.since==='string'&&Number.isFinite(Date.parse(value.since))
   &&new Date(value.since).toISOString()===value.since
   &&Date.parse(value.since)<=now&&Date.parse(value.since)>=now-7*86400000,'current_profile_evidence')
 return value
}

// The operator signs this only after the owner confirms this exact, already
// authenticated invitation. Neither a name nor an arbitrary profile ID resolves it.
export function readConfirmedRestoreInvitation(value,now=Date.now()){
 requireState(value&&Object.keys(value).sort().join(',')==='claimedAt,invitationId,ownerConfirmedAt'
   &&uuid.test(value.invitationId??'')
   &&['claimedAt','ownerConfirmedAt'].every(k=>typeof value[k]==='string'
     &&Number.isFinite(Date.parse(value[k]))&&new Date(value[k]).toISOString()===value[k]
     &&Date.parse(value[k])<=now&&Date.parse(value[k])>=now-7*86400000)
   &&Date.parse(value.claimedAt)<=Date.parse(value.ownerConfirmedAt),'confirmed_invitation')
 return value
}

export function readConfirmedCardRepairMode(value){
 requireState(value==='merge_confirmed_cards','card_repair_mode')
 return value
}

export function readImportedAccessAudit(value){
 requireState(Array.isArray(value)&&value.length===17,'imported_audit_scope')
 for(const item of value){
   requireState(item&&Object.keys(item).sort().join(',')==='code,expectedHistory,journalKind,profileId'
     &&/^F(?:0[1-9]|1[0-7])$/u.test(item.code)&&(item.profileId===null||uuid.test(item.profileId??''))
     &&['athlete','trainer_self'].includes(item.journalKind),'imported_audit_scope')
   readExpectedRestoreHistory(item.expectedHistory)
 }
 const unique=select=>new Set(value.map(select)).size===17
 const workouts=value.flatMap(v=>v.expectedHistory.workoutIds)
 const profiles=value.map(v=>v.profileId).filter(Boolean)
 requireState(unique(v=>v.code)&&new Set(profiles).size===profiles.length&&unique(v=>v.expectedHistory.clientId)
   &&value.filter(v=>v.journalKind==='trainer_self').length===1
   &&workouts.length<=1000&&new Set(workouts).size===workouts.length,'imported_audit_scope')
 return value
}

export function readAuditDetailCodes(value,scope){
 requireState(Array.isArray(value)&&value.length>=1&&value.length<=2&&new Set(value).size===value.length
   &&value.every(code=>typeof code==='string'&&/^F(?:0[1-9]|1[0-7])$/u.test(code)
     &&Array.isArray(scope)&&scope.some(item=>item.code===code)),'audit_details_scope')
 return value
}

async function importedCounts(client,expected){
 return (await client.query(`select
   (select count(*)::int from public.workouts where id=any($1::uuid[]) and client_id=$2 and status='done' and deleted_at is null) workouts,
   (select count(*)::int from public.workout_exercises where workout_id=any($1::uuid[]) and client_id=$2) exercises,
   (select count(*)::int from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id where e.workout_id=any($1::uuid[]) and e.client_id=$2 and s.client_id=$2) sets`,[expected.workoutIds,expected.clientId])).rows[0]
}
const countsMatch=(actual,expected)=>actual&&['workouts','exercises','sets'].every(key=>actual[key]===expected[key])
async function checkExpectedRestoreHistory(client,state,pair,expected){
 readExpectedRestoreHistory(expected)
 requireState(state.card.id===expected.clientId&&state.profiles.every(p=>p.identities===1),'expected_identity')
 const conflict=(await client.query(`select exists(select 1 from public.clients other
   join public.clients selected on selected.id=$1
   where other.id<>selected.id and other.archived_at is null and other.merged_into_client_id is null
   and lower(regexp_replace(btrim(other.full_name),'[[:space:]]+',' ','g'))=
       lower(regexp_replace(btrim(selected.full_name),'[[:space:]]+',' ','g'))
   and (other.trainer_id=$2 or exists(select 1 from public.client_trainers m where m.client_id=other.id and m.trainer_id=$2)
     or exists(select 1 from public.client_trainer_relationships r where r.client_id=other.id and r.trainer_id=$2))) conflict`,[expected.clientId,pair.trainerId])).rows[0]
 requireState(conflict?.conflict===false,'other_canonical_candidate')
 requireState(countsMatch(await importedCounts(client,expected),expected),'imported_history_changed')
}

export async function readRestoreState(client,pair,privateExpected=false){
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
 requireState(privateExpected
   ?groups.length>0&&groups.every(g=>g.client_id===card.id)
   :groups.length===1&&groups[0].client_id===card.id&&groups[0].status==='done'
     &&groups[0].deleted===false&&groups[0].count>=21,'history')
 const merges=bounded((await client.query(`select id,status,created_at,completed_at,actor_id from public.client_merge_operations
   where source_client_id=$1 and target_client_id=$2 order by created_at,id limit 11`,[sources[0].id,card.id])).rows,10)
 const foundations=(await client.query(`select name,run_on from app_private.fit_migrations
   where name like '000149%' or name like '000150%' order by name limit 3`)).rows
 const finance={}
 if(privateExpected)for(const table of ['trainer_finance_packages','trainer_finance_payments','trainer_finance_sessions']){
   const value=(await client.query(`select count(*)::int count,
     encode(sha256(convert_to(coalesce(string_agg(to_jsonb(item)::text,E'\\n' order by item.id),''),'UTF8')),'hex') digest
     from public.${table} item where client_id=any($1::uuid[])`,[[card.id,sources[0].id]])).rows[0]
   requireState(value&&Number.isSafeInteger(value.count)&&value.count<=5000,'finance_scope');finance[table]=value
 }
 return {profiles,card,source:sources[0],periods,memberships,history,groups,merges,foundations,...(privateExpected?{finance}:{})}
}

function publicState(state,pair){
 const label=id=>id===pair.trainerId?'trainer':id===pair.athleteId?'historicalAthlete':id?'otherProfile':null
 const time=value=>value?new Date(value).toISOString():null
 return {done:state.groups.filter(g=>g.client_id===state.card.id&&g.status==='done'&&!g.deleted).reduce((n,g)=>n+g.count,0),canonicalArchived:Boolean(state.card.archived_at),
   historicalAthleteYandexLinked:state.profiles.find(p=>p.id===pair.athleteId).identities>0,
   canonicalMembership:state.memberships.some(m=>m.client_id===state.card.id),
   activePeriods:state.periods.filter(p=>p.status==='active').length,
   periods:state.periods.map(p=>({trainer:label(p.trainer_id),status:p.status,connectedAt:time(p.connected_at),
     disconnectedAt:time(p.disconnected_at),createdAt:time(p.created_at),updatedAt:time(p.updated_at),
     connectedBy:label(p.connected_by),disconnectedBy:label(p.disconnected_by)})),
   merges:state.merges.map(m=>({status:m.status,createdAt:time(m.created_at),completedAt:time(m.completed_at),actor:label(m.actor_id)})),
   foundations:state.foundations.map(m=>({name:m.name,appliedAt:time(m.run_on)}))}
}

// Diagnostic evidence only: a same-name invitation is never an actor selection.
// This runs inside the existing owner-gated READ ONLY plan transaction. Tokens,
// provider subjects, invitation codes and contact fields are deliberately absent.
async function readIdentityEvidence(client,pair,state,expected,currentProfileEvidence){
 const feedback=currentProfileEvidence?bounded((await client.query(`select id,user_id,account_role,created_at
   from public.app_feedback where created_at>=$2::timestamptz
   and encode(sha256(convert_to(btrim(message),'UTF8')),'hex')=$1
   order by created_at,id limit 4`,[currentProfileEvidence.messageSha256,currentProfileEvidence.since])).rows,3):[]
 const exactCards=[state.card.id,...(state.sources??[state.source]).filter(Boolean).map(c=>c.id)]
 const invitations=bounded((await client.query(`select i.id,i.client_id,i.created_by,i.target_role,
   i.claimed_by,i.claimed_at,i.revoked_at,i.created_at,i.expires_at,
   c.auth_user_id,c.archived_at,c.merged_into_client_id,
   i.client_id=any($1::uuid[]) exact_import_card
   from public.client_invitations i join public.clients c on c.id=i.client_id
   join public.clients selected on selected.id=$2
   where i.created_by=$3 and i.target_role='client' and
     (i.client_id=any($1::uuid[]) or
       (i.created_at>=now()-interval '14 days' and
        lower(regexp_replace(btrim(c.full_name),'[[:space:]]+',' ','g'))=
        lower(regexp_replace(btrim(selected.full_name),'[[:space:]]+',' ','g'))))
   order by i.created_at desc,i.id limit 21`,[exactCards,expected.clientId,pair.trainerId])).rows,20)
 const ids=[...new Set([pair.trainerId,pair.athleteId,state.card.auth_user_id,...invitations.flatMap(i=>[i.claimed_by,i.auth_user_id]),...feedback.map(f=>f.user_id)].filter(Boolean))]
 requireState(ids.length<=46,'identity_evidence_scope')
 const profiles=bounded((await client.query(`select p.id,p.account_role,
   (select count(*)::int from app_private.auth_identities i where i.profile_id=p.id and i.provider='yandex') yandex_identities,
   (select count(*)::int from app_private.yandex_app_sessions s where s.profile_id=p.id and s.revoked_at is null and s.expires_at>now()) active_sessions,
   (select max(s.created_at) from app_private.yandex_app_sessions s where s.profile_id=p.id) latest_session_created_at,
   (select max(s.expires_at) from app_private.yandex_app_sessions s where s.profile_id=p.id and s.revoked_at is null) latest_unrevoked_session_expires_at
   from public.profiles p where p.id=any($1::uuid[]) order by p.id`,[ids])).rows,46)
 return {invitations,profiles,feedback,importedCounts:await importedCounts(client,expected),actorSelected:false,
   sameNameIsNotIdentityProof:true}
}

// Two claimed cards do not fit the existing single-card writer. Inventory both
// sides before choosing a recovery; this branch can never create an apply plan.
async function readRecoveryProfileReferences(client,ids){
 const quote=name=>{requireState(/^[a-z_][a-z0-9_]*$/u.test(name),'evidence_catalog');return '"'+name+'"'}
 const tables=bounded((await client.query(`select n.nspname schema,c.relname name,
   array_agg(distinct a.attname::text order by a.attname::text) columns,
   exists(select 1 from pg_attribute x where x.attrelid=c.oid and x.attname='client_id' and not x.attisdropped) has_client,
   exists(select 1 from pg_attribute x where x.attrelid=c.oid and x.attname in('owner_id','user_id','client_user_id','profile_id','auth_user_id') and not x.attisdropped) private_owner
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid and a.atttypid='uuid'::regtype and not a.attisdropped and a.attnum>0
   where n.nspname in('public','app_private') and c.relkind='r' and c.relname not in('profiles','clients')
   and (a.attname in('owner_id','user_id','profile_id','auth_user_id','client_user_id') or exists(
     select 1 from pg_constraint fk where fk.contype='f' and fk.conrelid=c.oid
       and fk.confrelid in('public.profiles'::regclass,'public.trainers'::regclass) and a.attnum=any(fk.conkey)))
   group by n.nspname,c.relname,c.oid order by n.nspname,c.relname limit 101`)).rows,100)
 const result=[]
 for(const t of tables){
   requireState(Array.isArray(t.columns)&&t.columns.length>0&&t.columns.length<=20,'evidence_catalog')
   const table=quote(t.schema)+'.'+quote(t.name)
   const predicate=t.columns.map(c=>`r.${quote(c)}=any($1::uuid[])`).join(' or ')
   const legacy=t.columns.map(c=>`r.${quote(c)}=$2::uuid`).join(' or ')
   const stats=(await client.query(`select count(*)::int count,count(*) filter(where ${legacy})::int legacy,
     coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint bytes from ${table} r where ${predicate}`,[ids,ids[0]])).rows[0]
   requireState(stats&&stats.count<=50000&&Number(stats.bytes)<=20*1024*1024,'evidence_scope')
   const hash=(await client.query(`select encode(sha256(convert_to(coalesce(string_agg(j,E'\n' order by j),''),'UTF8')),'hex') digest
     from (select to_jsonb(r)::text j from ${table} r where ${predicate}) s`,[ids])).rows[0].digest
   result.push({schema:t.schema,table:t.name,columns:t.columns,hasClient:t.has_client,privateOwner:t.private_owner,
     count:stats.count,legacy:stats.legacy,digest:hash})
 }
 return result
}

async function readConfirmedCardEvidence(client,pair,expected,proof){
 const invitation=(await client.query(`select i.id,i.client_id,i.created_by,i.claimed_by,i.claimed_at,
   i.revoked_at,i.target_role,c.auth_user_id,c.archived_at,c.merged_into_client_id
   from public.client_invitations i join public.clients c on c.id=i.client_id where i.id=$1`,[proof.invitationId])).rows[0]
 requireState(invitation&&invitation.created_by===pair.trainerId&&invitation.target_role==='client'
   &&invitation.claimed_by&&![pair.athleteId,pair.trainerId].includes(invitation.claimed_by)
   &&new Date(invitation.claimed_at).toISOString()===proof.claimedAt
   &&!invitation.revoked_at&&invitation.auth_user_id===invitation.claimed_by
   &&!invitation.archived_at&&!invitation.merged_into_client_id,'confirmed_invitation_binding')
 const currentId=invitation.claimed_by
 const profiles=bounded((await client.query(`select p.id,p.account_role,
   (select count(*)::int from app_private.auth_identities i where i.profile_id=p.id and i.provider='yandex') identities,
   (select count(*)::int from app_private.auth_identities i where i.profile_id=p.id and i.provider='yandex' and i.identity_origin='native') native_identities,
   (select count(*)::int from app_private.yandex_app_sessions s where s.profile_id=p.id and s.revoked_at is null and s.expires_at>now()) active_sessions
   from public.profiles p where id=any($1::uuid[]) order by id`,[[pair.trainerId,pair.athleteId,currentId]])).rows,3)
 requireState(profiles.length===3
   &&profiles.some(p=>p.id===pair.trainerId&&p.account_role==='trainer'&&p.identities===1)
   &&profiles.some(p=>p.id===pair.athleteId&&p.account_role==='client'&&p.identities===0&&p.active_sessions===0)
   &&profiles.some(p=>p.id===currentId&&p.account_role==='client'&&p.identities===1&&p.native_identities===1),'confirmed_profile_proof')
 const cards=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version,created_at,updated_at,
   encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') digest
   from public.clients c where auth_user_id=any($1::uuid[]) and merged_into_client_id is null order by id limit 4`,[[pair.athleteId,currentId]])).rows,3)
 requireState(cards.length===2&&cards.every(c=>!c.archived_at)
   &&cards.some(c=>c.id===expected.clientId&&c.auth_user_id===pair.athleteId)
   &&cards.some(c=>c.id===invitation.client_id&&c.auth_user_id===currentId),'confirmed_cards')
 requireState(countsMatch(await importedCounts(client,expected),expected),'imported_history_changed')
 const ids=cards.map(c=>c.id)
 const sources=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version
   from public.clients where merged_into_client_id=any($1::uuid[]) order by id limit 21`,[ids])).rows,20)
 const cardIds=[...ids,...sources.map(c=>c.id)]
 const periods=bounded((await client.query(`select id,client_id,trainer_id,status,connected_at,disconnected_at,
   connected_by,disconnected_by,source_invitation_id,created_at,updated_at
   from public.client_trainer_relationships where client_id=any($1::uuid[]) order by connected_at,id limit 101`,[cardIds])).rows,100)
 const memberships=bounded((await client.query(`select client_id,trainer_id,version,
   encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') digest
   from public.client_trainers m where client_id=any($1::uuid[]) order by client_id,trainer_id limit 101`,[cardIds])).rows,100)
 const groups=(await client.query(`select client_id,status,deleted_at is not null deleted,count(*)::int count
   from public.workouts where client_id=any($1::uuid[]) group by client_id,status,deleted_at is not null
   order by client_id,status,deleted`,[cardIds])).rows
 // Catalog identifiers are trusted only after validation. Bounded counts/bytes
 // precede aggregation; raw customer rows never leave PostgreSQL.
 const quote=name=>{requireState(/^[a-z_][a-z0-9_]*$/u.test(name),'evidence_catalog');return '"'+name+'"'}
 const tables=bounded((await client.query(`select n.nspname schema,c.relname name from pg_class c
   join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
   where n.nspname in('public','app_private') and c.relkind='r' and a.attname='client_id'
   and a.atttypid='uuid'::regtype and not a.attisdropped order by n.nspname,c.relname limit 101`)).rows,100)
 const cardData=[]
 for(const t of tables){
   const table=quote(t.schema)+'.'+quote(t.name)
   const stats=(await client.query(`select count(*)::int count,
     coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint bytes from ${table} r where client_id=any($1::uuid[])`,[cardIds])).rows[0]
   requireState(stats&&stats.count<=50000&&Number(stats.bytes)<=20*1024*1024,'evidence_scope')
   const rows=(await client.query(`select client_id,count(*)::int count,
     encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''),'UTF8')),'hex') digest
     from ${table} r where client_id=any($1::uuid[]) group by client_id order by client_id`,[cardIds])).rows
   cardData.push({schema:t.schema,table:t.name,rows})
 }
 const authorship=(await client.query(`select
   (select count(*)::int from public.workouts where created_by=$1) legacy_workouts,
   (select count(*)::int from public.chat_messages where sender_id=$1) legacy_messages`,[pair.athleteId])).rows[0]
 const chats=bounded((await client.query(`select id,client_id,client_user_id,trainer_id,
   encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') digest
   from public.chat_conversations c where client_id=any($1::uuid[]) or client_user_id=any($2::uuid[])
   order by id limit 101`,[cardIds,[pair.athleteId,currentId]])).rows,100)
 const invitationOperations=bounded((await client.query(`select actor_id,operation_id,client_id,invitation_id,created_at
   from app_private.new_client_invitation_operations where actor_id=$1 and client_id=any($2::uuid[])
   order by created_at,operation_id limit 21`,[pair.trainerId,cardIds])).rows,20)
 const profileReferences=await readRecoveryProfileReferences(client,[pair.athleteId,currentId])
 return {proof,invitation,currentId,profiles,cards,sources,periods,memberships,groups,cardData,authorship,chats,invitationOperations,profileReferences,
   importedCounts:await importedCounts(client,expected),writePlanReady:false}
}

// Only immutable receipt IDs are inspected. No workout notes, metrics, tokens,
// provider subjects or contact fields are selected for cause investigation.
async function readImportedWorkoutDetails(client,expected,canonicalId){
 const rows=bounded((await client.query(`select id,client_id,trainer_id,created_by,updated_by,
   status,deleted_at,workout_date::text,version,created_at,updated_at
   from public.workouts where id=any($1::uuid[]) order by id`,[expected.workoutIds])).rows,expected.workoutIds.length)
 return expected.workoutIds.map(id=>{
   const row=rows.find(r=>r.id===id)
   return row?{...row,reason:row.client_id!==canonicalId?'outside_canonical':row.deleted_at?'soft_deleted':
     row.status!=='done'?'status_changed':'done_not_deleted'}:{id,reason:'missing'}
 })
}

async function readImportedIdentityTrace(client,profileId,cardIds){
 const profile=(await client.query(`select id,account_role,created_at,updated_at
   from public.profiles where id=$1`,[profileId])).rows[0]
 const identities=bounded((await client.query(`select provider,identity_origin,created_at
   from app_private.auth_identities where profile_id=$1 order by provider`,[profileId])).rows,4)
 const rollout=(await client.query(`select target_backend,access_mode,enabled,created_at,updated_at
   from app_private.profile_rollout_assignments where profile_id=$1`,[profileId])).rows[0]??null
 const appSessions=(await client.query(`select count(*)::int retained,
   count(*) filter(where revoked_at is null and expires_at>now())::int active,
   count(*) filter(where revoked_at is not null)::int revoked,
   min(created_at) earliest_retained_created_at,max(created_at) latest_retained_created_at,
   max(expires_at) latest_retained_expires_at from app_private.yandex_app_sessions where profile_id=$1`,[profileId])).rows[0]
 const pilotSessions=(await client.query(`select count(*)::int retained,
   count(*) filter(where expires_at>now())::int active,
   min(created_at) earliest_retained_created_at,max(created_at) latest_retained_created_at,
   max(expires_at) latest_retained_expires_at from app_private.yandex_pilot_sessions where profile_id=$1`,[profileId])).rows[0]
 const merges=bounded((await client.query(`select source_client_id,target_client_id,actor_id,status,created_at,completed_at
   from public.client_merge_operations where source_client_id=any($1::uuid[]) or target_client_id=any($1::uuid[])
   order by created_at,id limit 21`,[cardIds])).rows,20)
 return {profile,identities,rollout,appSessions,pilotSessions,merges,
   sessionHistoryMayHaveBeenPurged:true,absentSessionIsNotProofOfNoPriorLogin:true,actorSelected:false}
}

async function readImportedAccessState(client,trainerId,scope,detailCodes=[]){
 const results=[]
 for(const item of scope){
   const chain=[];let id=item.expectedHistory.clientId,issue=null
   while(id){
     if(chain.length>=4||chain.some(c=>c.id===id)){issue='invalid_merge_chain';break}
     const card=(await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version,created_at
       from public.clients where id=$1`,[id])).rows[0]
     if(!card){issue='missing_card';break}
     chain.push(card);id=card.merged_into_client_id
   }
   if(issue){results.push({code:item.code,expectedHistory:item.expectedHistory,chain,issue,
     importedHistoryMatches:false,actorSelected:false,writePlanReady:false});continue}
   const card=chain.at(-1)
   const sources=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id
     from public.clients where merged_into_client_id=$1 order by id limit 21`,[card.id])).rows,20)
   const ids=[...new Set([...chain.map(c=>c.id),...sources.map(c=>c.id)])]
   const pair={trainerId,athleteId:item.profileId}
   const identityEvidence=await readIdentityEvidence(client,pair,{card,sources},item.expectedHistory,null)
   const periods=bounded((await client.query(`select id,client_id,trainer_id,status,connected_at,disconnected_at,
     connected_by,disconnected_by,source_invitation_id from public.client_trainer_relationships
     where client_id=any($1::uuid[]) order by connected_at,id limit 101`,[ids])).rows,100)
   const memberships=bounded((await client.query(`select client_id,trainer_id from public.client_trainers
     where client_id=any($1::uuid[]) order by client_id,trainer_id limit 101`,[ids])).rows,100)
   const owner=identityEvidence.profiles.find(p=>p.id===card.auth_user_id)??null
   const expectedAtCanonical={...item.expectedHistory,clientId:card.id}
   const counts=await importedCounts(client,expectedAtCanonical)
   const workoutDetails=!detailCodes.includes(item.code)?null:
     await readImportedWorkoutDetails(client,item.expectedHistory,card.id)
   const identityTrace=detailCodes.includes(item.code)&&card.auth_user_id&&owner?.yandex_identities!==1&&item.journalKind!=='trainer_self'
     ?await readImportedIdentityTrace(client,card.auth_user_id,ids):null
   results.push({code:item.code,originalProfileId:item.profileId,expectedHistory:item.expectedHistory,
     chain,sources,card,owner,periods,memberships,identityEvidence,importedAtCanonical:counts,
     importedHistoryMatches:countsMatch(counts,item.expectedHistory),
     nativeOwnerPresent:owner?.yandex_identities===1,
     trainerOwnJournal:item.journalKind==='trainer_self',cardUnclaimed:card.auth_user_id===null,
     trainerSelfNamespaceMatches:item.journalKind!=='trainer_self'||(card.trainer_id===trainerId&&[null,trainerId].includes(card.auth_user_id)),
     sameNameInvitationsAreNotIdentityProof:true,actorSelected:false,writePlanReady:false})
   if(workoutDetails)results.at(-1).workoutDetails=workoutDetails
   if(identityTrace)results.at(-1).identityTrace=identityTrace
 }
 return results
}

export async function readImportedAccessVisibility(runtime,diagnostic){
 const {pair,importedAccessAudit:audits}=diagnostic
 requireState(Array.isArray(audits)&&audits.length===17&&audits.every(x=>x.writePlanReady===false),'imported_audit_scope')
 await runtime.query('begin transaction isolation level repeatable read read only')
 try{
   const role=(await runtime.query(`select current_user username,current_setting('transaction_read_only') readonly,
     rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
   requireState(role?.username==='fit_api'&&role.readonly==='on'&&!role.rolsuper&&!role.rolbypassrls,'runtime_role')
   await runtime.query("set local statement_timeout='10s'")
   await runtime.query("set local lock_timeout='2s'")
   // The trainer app fetches these lists once. Do the same for the bounded
   // scope instead of recomputing the full overview for every imported card.
   const ids=audits.filter(a=>a.card).map(a=>a.card.id)
   await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[pair.trainerId])
   const trainerCards=(await runtime.query(`select id,auth_user_id,archived_at,merged_into_client_id
     from public.clients where id=any($1::uuid[])`,[ids])).rows
   const trainerLinks=(await runtime.query(`select client_id,trainer_id from public.list_accessible_client_trainers()
     where client_id=any($1::uuid[]) order by client_id,trainer_id`,[ids])).rows
   const trainerOverviews=(await runtime.query(`select id,done_count,has_account from public.list_client_overviews(false)
     where id=any($1::uuid[]) order by id`,[ids])).rows
   const result=[],trainerViews=new Map()
   for(const audit of audits){
     if(!audit.card)continue
     const expected={...audit.expectedHistory,clientId:audit.card.id}
     const counts=await importedCounts(runtime,expected)
     trainerViews.set(audit.code,{canonical:trainerCards.filter(c=>c.id===audit.card.id),
       trainers:trainerLinks.filter(c=>c.client_id===audit.card.id),overviews:trainerOverviews.filter(c=>c.id===audit.card.id),
       importedCounts:counts,allImportedReadable:countsMatch(counts,expected)})
     if(audit.workoutDetails){
       trainerViews.get(audit.code).readableImportedIds=(await runtime.query(
         'select id from public.workouts where id=any($1::uuid[]) order by id',[expected.workoutIds])).rows.map(r=>r.id)
     }
   }
   for(const audit of audits){
     if(!audit.card){result.push({code:audit.code,issue:audit.issue,resolved:false,writePlanReady:false});continue}
     const expected={...audit.expectedHistory,clientId:audit.card.id},actors={trainer:trainerViews.get(audit.code)}
     const actor=audit.card.auth_user_id
     if(!actor)actors.recordedOwner={missing:true}
     else if(actor===pair.trainerId)actors.recordedOwner=trainerViews.get(audit.code)
     else{
       await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[actor])
       // The athlete app resolves its own canonical card, not the trainer's
       // complete client-overview list. Preserve that distinction in the audit.
       const canonical=(await runtime.query(`select id,auth_user_id,archived_at,merged_into_client_id
         from public.clients where id=$1 and auth_user_id=$2`,[audit.card.id,actor])).rows
       const trainers=(await runtime.query(`select client_id,trainer_id from public.list_accessible_client_trainers()
         where client_id=$1 order by trainer_id`,[audit.card.id])).rows
       const counts=await importedCounts(runtime,expected)
       actors.recordedOwner={canonical,trainers,importedCounts:counts,allImportedReadable:countsMatch(counts,expected)}
     }
     result.push({code:audit.code,actors,recordedOwnerHasNativeIdentity:audit.nativeOwnerPresent,
       recordedOwnerIsNotIndependentlyConfirmedCurrentLogin:!audit.nativeOwnerPresent&&!audit.cardUnclaimed&&!audit.trainerOwnJournal,
       trainerOwnJournal:audit.trainerOwnJournal,cardUnclaimed:audit.cardUnclaimed,
       currentAccountRelevant:!audit.trainerOwnJournal&&!audit.cardUnclaimed,writePlanReady:false})
   }
   await runtime.query('commit');return result
 }catch(error){await runtime.query('rollback');throw error}
}

export async function readConfirmedRestoreVisibility(runtime,diagnostic){
 const {pair,expectedHistory:expected,confirmedCardEvidence:evidence}=diagnostic
 requireState(evidence?.writePlanReady===false&&uuid.test(evidence.currentId),'confirmed_diagnostic')
 const cardIds=evidence.cards.map(c=>c.id)
 await runtime.query('begin transaction isolation level repeatable read read only')
 try{
   const role=(await runtime.query(`select current_user username,current_setting('transaction_read_only') readonly,
     rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
   requireState(role?.username==='fit_api'&&role.readonly==='on'&&!role.rolsuper&&!role.rolbypassrls,'runtime_role')
   await runtime.query("set local statement_timeout='10s'")
   await runtime.query("set local lock_timeout='2s'")
   const result={}
   for(const [label,actor] of [['athlete',evidence.currentId],['trainer',pair.trainerId]]){
     await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[actor])
     const ownCards=(await runtime.query(`select id from public.clients where auth_user_id=$1
       and merged_into_client_id is null order by id limit 3`,[actor])).rows
     const trainers=(await runtime.query(`select client_id,trainer_id from public.list_accessible_client_trainers()
       where client_id=any($1::uuid[]) order by client_id,trainer_id`,[cardIds])).rows
     const overviews=(await runtime.query(`select id,done_count,has_account from public.list_client_overviews(false)
       where id=any($1::uuid[]) order by id`,[cardIds])).rows
     result[label]={ownCards,trainers,overviews,importedCounts:await importedCounts(runtime,expected)}
   }
   await runtime.query('commit');return result
 }catch(error){await runtime.query('rollback');throw error}
}

const mergeMoving=new Set(['public.workouts','public.workout_exercises','public.workout_sets',
 'public.trainer_finance_packages','public.trainer_finance_payments','public.trainer_finance_sessions',
 'public.trainer_finance_events','app_private.quick_start_operations'])
const mergeTraining=new Set(['workouts','workout_exercises','workout_sets'])
const mergeFinance=new Set(['trainer_finance_packages','trainer_finance_payments','trainer_finance_sessions'])
const catalogQuote=name=>{requireState(/^[a-z_][a-z0-9_]*$/u.test(name),'merge_catalog');return '"'+name+'"'}
const sqlDigest=value=>`encode(sha256(convert_to((${value})::text,'UTF8')),'hex')`

// A card merge is deliberately not a profile merge. Private profile history,
// identities, conversations, memberships and periods remain byte-identical.
async function readCardMergeState(client,pair,sourceId,targetId,predecessorId,confirmedCurrentId){
 const ids=[sourceId,targetId,predecessorId]
 const cards=(await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version::int version,
   profile_photo,${sqlDigest("to_jsonb(c)-array['archived_at','merged_into_client_id','version','updated_at','profile_photo']")} stable,
   ${sqlDigest('to_jsonb(c)')} digest from public.clients c where id=any($1::uuid[]) order by id`,[ids])).rows
 requireState(cards.length===3,'merge_cards')
 const currentId=cards.find(c=>c.id===targetId).auth_user_id
 requireState(currentId===confirmedCurrentId,'merge_native_owner_changed')
 const catalog=bounded((await client.query(`select n.nspname schema,c.relname name from pg_class c
   join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
   where n.nspname in('public','app_private') and c.relkind='r' and a.attname='client_id'
   and a.atttypid='uuid'::regtype and not a.attisdropped order by n.nspname,c.relname limit 101`)).rows,100)
 const tables=[]
 for(const t of catalog){
   const table=catalogQuote(t.schema)+'.'+catalogQuote(t.name),moving=mergeMoving.has(t.schema+'.'+t.name)
   const stats=(await client.query(`select count(*)::int count,coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint bytes
     from ${table} r where client_id=any($1::uuid[])`,[ids])).rows[0]
   requireState(stats.count<=50000&&Number(stats.bytes)<=20*1024*1024,'merge_scope')
   if(moving){
     const removed=mergeTraining.has(t.name)?['client_id','trainer_id','updated_at']:
       mergeFinance.has(t.name)?['client_id','updated_at']:['client_id']
     const key=t.name==='quick_start_operations'?"jsonb_build_array(r.actor_id,r.operation_id)::text":"r.id::text"
     const rows=(await client.query(`select ${key} key,client_id,
       ${mergeTraining.has(t.name)||t.name.startsWith('trainer_finance_')?'trainer_id,':''}
       ${sqlDigest('to_jsonb(r)')} digest,${sqlDigest('to_jsonb(r)-$2::text[]')} stable
       from ${table} r where client_id=any($1::uuid[]) order by ${key}`,[ids,removed])).rows
     tables.push({...t,moving,rows})
   }else{
     const rows=(await client.query(`select client_id,count(*)::int count,
       ${sqlDigest("coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')")} digest
       from ${table} r where client_id=any($1::uuid[]) group by client_id order by client_id`,[ids])).rows
     tables.push({...t,moving,rows})
   }
 }
 // Tables already conserved row-by-row above may legitimately change namespace.
 const profileReferences=(await readRecoveryProfileReferences(client,[pair.athleteId,currentId]))
   .filter(t=>!mergeMoving.has(t.schema+'.'+t.table))
 const profiles=(await client.query(`select id,${sqlDigest('to_jsonb(p)')} digest
   from public.profiles p where id=any($1::uuid[]) order by id`,[[pair.trainerId,pair.athleteId,currentId]])).rows
 const identities=(await client.query(`select profile_id,provider,identity_origin,
   ${sqlDigest('to_jsonb(i)')} digest from app_private.auth_identities i
   where profile_id=any($1::uuid[]) order by profile_id,provider,identity_origin`,[[pair.trainerId,pair.athleteId,currentId]])).rows
 const merges=bounded((await client.query(`select id,source_client_id,target_client_id,invitation_id,actor_id,status,
   ${sqlDigest('to_jsonb(m)')} digest from public.client_merge_operations m
   where source_client_id=any($1::uuid[]) or target_client_id=any($1::uuid[]) order by id limit 21`,[ids])).rows,20)
 const triggers=[]
 for(const [schema,name,columns] of [['public','clients',['archived_at','merged_into_client_id','version','profile_photo']],
   ...[...mergeMoving].map(t=>{const [s,n]=t.split('.');return [s,n,mergeTraining.has(n)?['client_id','trainer_id']:['client_id']]})]){
   const rows=(await client.query(`select t.tgname name,p.proname function,n.nspname schema,
     ${sqlDigest('pg_get_triggerdef(t.oid)||pg_get_functiondef(p.oid)')} digest
     from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
     where t.tgrelid=$1::regclass and not t.tgisinternal and (t.tgtype::int&16)<>0
     and (t.tgattr=''::int2vector or exists(select 1 from pg_attribute a
       where a.attrelid=t.tgrelid and a.attnum=any(t.tgattr) and a.attname=any($2::text[])))
     order by t.tgname`,[schema+'.'+name,columns])).rows
   requireState(rows.every(t=>['set_updated_at','prevent_workout_client_reassignment',
     'guard_fit_lime_fixture_identity','preserve_merged_client_photo','record_trainer_finance_event'].includes(t.function)),
     'merge_unsupported_trigger')
   triggers.push({schema,name,rows})
 }
 return {cards,tables,profileReferences,profiles,identities,merges,triggers}
}

async function planConfirmedCardMerge(client,pair,expected,proof){
 const evidence=await readConfirmedCardEvidence(client,pair,expected,proof)
 const source=evidence.cards.find(c=>c.id===expected.clientId),target=evidence.cards.find(c=>c.id===evidence.invitation.client_id)
 requireState(source.trainer_id===pair.athleteId&&target.trainer_id===pair.trainerId,'merge_namespace')
 requireState(evidence.sources.length===1&&evidence.sources[0].merged_into_client_id===source.id
   &&evidence.sources[0].archived_at&&evidence.sources[0].auth_user_id===null
   &&evidence.sources[0].trainer_id===pair.trainerId,'merge_predecessor')
 requireState(evidence.authorship.legacy_workouts===0,'merge_legacy_authorship')
 requireState(evidence.periods.every(p=>p.trainer_id===pair.trainerId)
   &&evidence.periods.filter(p=>p.status==='active').length===1
   &&evidence.periods.some(p=>p.client_id===target.id&&p.status==='active')
   &&evidence.memberships.every(m=>m.trainer_id===pair.trainerId)
   &&evidence.memberships.some(m=>m.client_id===target.id),'merge_existing_connection')
 const invalid=(await client.query(`select
   exists(select 1 from public.workouts where client_id=$1 and created_by is null) null_author,
   exists(select 1 from public.workout_exercises where client_id=$1 and
     (exercise_source='custom' or custom_exercise_id is not null)) custom_catalog,
   exists(select 1 from public.workouts where client_id=$2) target_workouts,
   exists(select 1 from public.workout_exercises where client_id=$2) target_exercises,
   exists(select 1 from public.workout_sets where client_id=$2) target_sets`,[source.id,target.id])).rows[0]
 requireState(invalid&&Object.values(invalid).every(v=>v===false),'merge_history_conflict')
 const state=await readCardMergeState(client,pair,source.id,target.id,evidence.sources[0].id,evidence.currentId)
 requireState(state.merges.some(m=>m.source_client_id===evidence.sources[0].id&&m.target_client_id===source.id
   &&m.status==='completed'&&m.actor_id===pair.athleteId),'merge_prior_receipt')
 const preserved=new Set(['public.client_invitations','public.client_trainers','public.client_trainer_relationships','public.chat_conversations'])
 for(const t of state.tables)if(!t.moving&&!preserved.has(t.schema+'.'+t.name))
   requireState(!t.rows.some(r=>r.client_id===source.id&&r.count>0),'merge_unsupported_source_data')
 for(const t of state.tables)if(t.name.startsWith('trainer_finance_'))requireState(t.rows.every(r=>r.trainer_id===pair.trainerId),'merge_finance_owner')
 const periodId=evidence.periods.find(p=>p.client_id===target.id&&p.status==='active').id
 const plan={schema:3,ticket:'YAFIT-701',repairMode:'merge_confirmed_cards',createdAt:Date.now(),pair,
   periodId,mergeId:randomUUID(),currentId:evidence.currentId,sourceId:source.id,targetId:target.id,
   predecessorId:evidence.sources[0].id,expectedHistory:expected,confirmedInvitation:proof,state,fingerprint:fingerprint(state)}
 plan.expectedBinding=mergePlanBinding(plan)
 requireState(Buffer.byteLength(JSON.stringify(plan),'utf8')<1800000,'merge_plan_scope')
 return {...plan,report:{event:'client_restore_plan',readOnly:true,existingCardsOnly:true}}
}
const mergePlanBinding=p=>fingerprint({schema:p.schema,repairMode:p.repairMode,pair:p.pair,periodId:p.periodId,
 mergeId:p.mergeId,currentId:p.currentId,sourceId:p.sourceId,targetId:p.targetId,predecessorId:p.predecessorId,
 expectedHistory:p.expectedHistory,confirmedInvitation:p.confirmedInvitation,fingerprint:p.fingerprint,createdAt:p.createdAt})
export function validateCardMergePlan(plan){
 requireState(plan?.schema===3&&plan.ticket==='YAFIT-701'&&plan.repairMode==='merge_confirmed_cards'
   &&['periodId','mergeId','currentId','sourceId','targetId','predecessorId'].every(k=>uuid.test(plan[k]??''))
   &&uuid.test(plan.pair?.trainerId??'')&&uuid.test(plan.pair?.athleteId??'')
   &&new Set([plan.sourceId,plan.targetId,plan.predecessorId]).size===3
   &&plan.sourceId===plan.expectedHistory?.clientId&&fingerprint(plan.state)===plan.fingerprint
   &&mergePlanBinding(plan)===plan.expectedBinding,'merge_plan')
 readExpectedRestoreHistory(plan.expectedHistory)
}

async function checkCardMergeAfter(client,plan){
 validateCardMergePlan(plan)
 const before=plan.state,after=await readCardMergeState(client,plan.pair,plan.sourceId,plan.targetId,plan.predecessorId,plan.currentId)
 for(const key of ['profiles','identities','profileReferences','triggers'])
   requireState(fingerprint(before[key])===fingerprint(after[key]),'merge_protected_state_changed')
 for(const old of before.cards){
   const card=after.cards.find(c=>c.id===old.id)
   requireState(card&&card.stable===old.stable&&card.auth_user_id===old.auth_user_id&&card.trainer_id===old.trainer_id,'merge_card_changed')
   if(old.id===plan.targetId){
     const photo=old.profile_photo??(before.cards.find(c=>c.id===plan.sourceId).profile_photo
       ?{...before.cards.find(c=>c.id===plan.sourceId).profile_photo,version:1}:null)
     requireState(!card.archived_at&&!card.merged_into_client_id&&card.version===old.version
       &&fingerprint(card.profile_photo)===fingerprint(photo),'merge_target_changed')
     if(!photo||old.profile_photo)requireState(card.digest===old.digest,'merge_target_changed')
   }else requireState(card.archived_at&&card.merged_into_client_id===plan.targetId
     &&card.version===old.version+1&&fingerprint(card.profile_photo)===fingerprint(old.profile_photo)
     &&(old.id!==plan.predecessorId||new Date(card.archived_at).toISOString()===new Date(old.archived_at).toISOString()),'merge_source_changed')
 }
 const financialRows=[]
 for(const t of before.tables){
   const a=after.tables.find(x=>x.schema===t.schema&&x.name===t.name)
   requireState(a&&a.moving===t.moving,'merge_catalog_changed')
   if(!t.moving){requireState(fingerprint(t)===fingerprint(a),'merge_protected_card_data');continue}
   const oldKeys=new Set(t.rows.map(r=>r.key))
   for(const r of t.rows){
     const found=a.rows.find(x=>x.key===r.key)
     requireState(found,'merge_row_missing')
     if(r.client_id===plan.sourceId){
       requireState(found.client_id===plan.targetId&&r.stable===found.stable
         &&(!mergeTraining.has(t.name)||found.trainer_id===plan.pair.trainerId),'merge_row_changed')
       if(mergeFinance.has(t.name))financialRows.push({table:t.name,before:r,after:found})
     }else requireState(fingerprint(r)===fingerprint(found),'merge_existing_target_changed')
   }
   const extra=a.rows.filter(r=>!oldKeys.has(r.key))
   if(t.name!=='trainer_finance_events')requireState(extra.length===0,'merge_unexpected_rows')
 }
 requireState(after.tables.length===before.tables.length,'merge_catalog_changed')
 // Finance update triggers append only audit metadata. Existing balances,
 // package/payment/session IDs and every monetary field are conserved above.
 const oldEvents=before.tables.find(t=>t.name==='trainer_finance_events').rows.map(r=>r.key)
 const events=(await client.query(`select id::text key,entity_type,entity_id::text,trainer_id,client_id,actor_id,event_type,
   ${sqlDigest('previous_data')} previous,${sqlDigest('current_data')} current
   from public.trainer_finance_events where client_id=any($1::uuid[]) and not id=any($2::bigint[]) order by id`,
   [[plan.sourceId,plan.targetId,plan.predecessorId],oldEvents])).rows
 requireState(events.length===financialRows.length&&financialRows.every(r=>events.filter(e=>e.entity_type===
   ({trainer_finance_packages:'package',trainer_finance_payments:'payment',trainer_finance_sessions:'session'})[r.table]
   &&e.entity_id===r.before.key&&e.previous===r.before.digest&&e.current===r.after.digest
   &&e.trainer_id===plan.pair.trainerId&&e.client_id===plan.targetId&&e.actor_id===plan.pair.trainerId
   &&e.event_type==='updated').length===1),'merge_finance_audit_changed')
 requireState(before.merges.every(m=>after.merges.some(a=>fingerprint(m)===fingerprint(a)))
   &&after.merges.length===before.merges.length+1,'merge_receipts_changed')
 const receipt=after.merges.find(m=>m.id===plan.mergeId)
 requireState(receipt?.status==='completed'&&receipt.source_client_id===plan.sourceId&&receipt.target_client_id===plan.targetId
   &&receipt.actor_id===plan.pair.trainerId&&receipt.invitation_id===plan.confirmedInvitation.invitationId,'merge_receipt')
 requireState(countsMatch(await importedCounts(client,{...plan.expectedHistory,clientId:plan.targetId}),plan.expectedHistory),'merge_imported_history')
 return after
}

async function applyConfirmedCardMerge(client,plan,{backupVerified=false}={}){
 validateCardMergePlan(plan)
 requireState(Number.isSafeInteger(plan.createdAt)&&Date.now()>=plan.createdAt&&Date.now()-plan.createdAt<=3600000,'merge_plan_expired')
 requireState(backupVerified,'backup_required')
 await client.query('begin transaction isolation level serializable read write')
 try{
   await ownerGate(client,true)
   for(const id of [plan.pair.athleteId,plan.currentId].sort())
     await client.query("select pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||$1::text,0))",[id])
   await client.query('select id from public.clients where id=any($1::uuid[]) order by id for update',[[plan.sourceId,plan.targetId,plan.predecessorId]])
   const replay=(await client.query('select id from public.client_merge_operations where id=$1',[plan.mergeId])).rows.length===1
   if(replay){await checkCardMergeAfter(client,plan);await client.query('commit');return {event:'client_restore_applied',replayed:true,historyUnchanged:true}}
   const fresh=await planConfirmedCardMerge(client,plan.pair,plan.expectedHistory,plan.confirmedInvitation)
   requireState(fresh.currentId===plan.currentId&&fresh.periodId===plan.periodId&&fresh.fingerprint===plan.fingerprint,'merge_state_changed')
   await client.query("select set_config('request.jwt.claim.sub',$1,true)",[plan.pair.trainerId])
   await client.query(`insert into public.client_merge_operations(id,source_client_id,target_client_id,invitation_id,actor_id,dependency_counts_before)
     values($1,$2,$3,$4,$5,jsonb_build_object('source',app_private.client_dependency_counts($2),'target',app_private.client_dependency_counts($3)))`,
     [plan.mergeId,plan.sourceId,plan.targetId,plan.confirmedInvitation.invitationId,plan.pair.trainerId])
   await client.query('set constraints all deferred')
   await client.query(`update public.clients set archived_at=now(),merged_into_client_id=$2,version=version+1 where id=$1`,[plan.sourceId,plan.targetId])
   await client.query(`update public.clients set merged_into_client_id=$2,version=version+1 where id=$1`,[plan.predecessorId,plan.targetId])
   // Remap pre-existing finance audit namespaces before triggers append new ones.
   for(const table of ['trainer_finance_events','trainer_finance_payments','trainer_finance_sessions','trainer_finance_packages'])
     await client.query(`update public.${catalogQuote(table)} set client_id=$2 where client_id=$1`,[plan.sourceId,plan.targetId])
   await client.query('update app_private.quick_start_operations set client_id=$2 where client_id=$1',[plan.sourceId,plan.targetId])
   for(const table of ['workout_sets','workout_exercises','workouts'])await client.query(`update public.${catalogQuote(table)}
     set client_id=$2,trainer_id=$3 where client_id=$1`,[plan.sourceId,plan.targetId,plan.pair.trainerId])
   await client.query(`update public.client_merge_operations set status='completed',completed_at=now(),dependency_counts_after=
     jsonb_build_object('source',app_private.client_dependency_counts($2),'target',app_private.client_dependency_counts($3)) where id=$1`,
     [plan.mergeId,plan.sourceId,plan.targetId])
   await checkCardMergeAfter(client,plan)
   await client.query('set constraints all immediate')
   await client.query('commit')
   return {event:'client_restore_applied',replayed:false,historyUnchanged:true}
 }catch(error){await client.query('rollback');throw error}
}

export async function verifyConfirmedCardMergeOwner(owner,plan){
 await owner.query('begin transaction isolation level repeatable read read only')
 try{await ownerGate(owner);await checkCardMergeAfter(owner,plan);await owner.query('commit');return {historyUnchanged:true}}
 catch(error){await owner.query('rollback');throw error}
}

export async function planClientRestore(client,pair,expectedHistory=null,currentProfileEvidence=null,confirmedInvitation=null,importedAccessAudit=null,repairMode=null,auditDetailCodes=null){
 if(expectedHistory)readExpectedRestoreHistory(expectedHistory)
 if(currentProfileEvidence){readCurrentProfileEvidence(currentProfileEvidence);readExpectedRestoreHistory(expectedHistory)}
 if(confirmedInvitation){readConfirmedRestoreInvitation(confirmedInvitation);readExpectedRestoreHistory(expectedHistory)
   requireState(!currentProfileEvidence,'conflicting_evidence')}
 if(importedAccessAudit){readImportedAccessAudit(importedAccessAudit);readExpectedRestoreHistory(expectedHistory)
   requireState(!currentProfileEvidence,'conflicting_evidence')}
 if(auditDetailCodes){readAuditDetailCodes(auditDetailCodes,importedAccessAudit);requireState(!repairMode&&!confirmedInvitation&&!currentProfileEvidence,'conflicting_evidence')}
 if(repairMode){readConfirmedCardRepairMode(repairMode);requireState(confirmedInvitation&&!currentProfileEvidence&&!importedAccessAudit,'conflicting_evidence')}
 let privateDiagnostic
 await client.query('begin transaction isolation level repeatable read read only')
 try{
   await ownerGate(client)
   if(repairMode){const plan=await planConfirmedCardMerge(client,pair,expectedHistory,confirmedInvitation);await client.query('commit');return plan}
   if(importedAccessAudit){
     privateDiagnostic={pair,expectedHistory,importedAccessAudit:await readImportedAccessState(client,pair.trainerId,importedAccessAudit,auditDetailCodes??[])}
     if(confirmedInvitation)privateDiagnostic.confirmedCardEvidence=await readConfirmedCardEvidence(client,pair,expectedHistory,confirmedInvitation)
     requireState(false,'imported_access_audit_complete')
   }
   if(confirmedInvitation){
     privateDiagnostic={pair,expectedHistory,confirmedCardEvidence:
       await readConfirmedCardEvidence(client,pair,expectedHistory,confirmedInvitation)}
     requireState(false,'confirmed_cards_review_required')
   }
   if(currentProfileEvidence){
     // Resolve the immutable imported card directly. Requiring its old owner
     // first would hide a legitimate intervening ownership change from diagnosis.
     const cards=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version
       from public.clients where id=$1 limit 2`,[expectedHistory.clientId])).rows,1)
     requireState(cards.length===1,'identity_evidence_card')
     const sources=bounded((await client.query(`select id,auth_user_id,trainer_id,archived_at,merged_into_client_id,version
       from public.clients where merged_into_client_id=$1 and trainer_id=$2 order by id limit 21`,[cards[0].id,pair.trainerId])).rows,20)
     const state={card:cards[0],sources}
     privateDiagnostic={pair,state,expectedHistory}
     privateDiagnostic.identityEvidence=await readIdentityEvidence(client,pair,state,expectedHistory,currentProfileEvidence)
     // This branch always rolls back READ ONLY and cannot create an apply plan.
     requireState(false,'identity_evidence_review_required')
   }
   const state=await readRestoreState(client,pair,Boolean(expectedHistory))
   if(expectedHistory){
     privateDiagnostic={pair,state,expectedHistory}
     if(state.card.id===expectedHistory.clientId&&state.profiles.some(p=>p.identities!==1))
       privateDiagnostic.identityEvidence=await readIdentityEvidence(client,pair,state,expectedHistory,currentProfileEvidence)
   }
   if(expectedHistory)await checkExpectedRestoreHistory(client,state,pair,expectedHistory)
   requireState(!state.periods.some(p=>p.status==='active'),'already_connected')
   requireState(state.periods.some(p=>p.trainer_id===pair.trainerId&&p.status==='disconnected'),'no_previous_period')
   await client.query('commit')
   // Kept only in a root-owned private plan file. No identifiers/fingerprints go to logs.
   return {schema:1,ticket:'YAFIT-701',createdAt:Date.now(),pair,periodId:randomUUID(),state,
     fingerprint:fingerprint(state),...(expectedHistory?{expectedHistory,expectedBinding:fingerprint({pair,state,expectedHistory})}:{}),
     report:{event:'client_restore_plan',readOnly:true,...publicState(state,pair)}}
 }catch(error){
   await client.query('rollback')
   if(privateDiagnostic)error.privateDiagnostic=privateDiagnostic
   throw error
 }
}

export async function applyClientRestore(client,plan,{backupVerified=false}={}){
 if(plan?.schema===3)return applyConfirmedCardMerge(client,plan,{backupVerified})
 requireState(plan?.schema===1&&plan.ticket==='YAFIT-701'&&uuid.test(plan.periodId)
   &&uuid.test(plan.pair?.trainerId)&&uuid.test(plan.pair?.athleteId)
   &&Number.isSafeInteger(plan.createdAt)&&Date.now()-plan.createdAt>=0
   &&Date.now()-plan.createdAt<=3600000&&fingerprint(plan.state)===plan.fingerprint,'plan')
 requireState(backupVerified,'backup_required')
 const {pair}=plan
 if(plan.expectedHistory){
   readExpectedRestoreHistory(plan.expectedHistory)
   requireState(plan.expectedBinding===fingerprint({pair,state:plan.state,expectedHistory:plan.expectedHistory}),'expected_binding')
 }
 await client.query('begin transaction isolation level serializable read write')
 try{
   await ownerGate(client,true)
   await client.query("select pg_advisory_xact_lock(hashtextextended('fit-client-claim:'||$1::text,0))",[pair.athleteId])
   await client.query('select id from public.clients where id=any($1::uuid[]) order by id for update',[[plan.state.card.id,plan.state.source.id]])
   await client.query('select client_id from public.client_trainers where client_id=any($1::uuid[]) and trainer_id=$2 order by client_id for update',[[plan.state.card.id,plan.state.source.id],pair.trainerId])
   const current=await readRestoreState(client,pair,Boolean(plan.expectedHistory))
   if(plan.expectedHistory)await checkExpectedRestoreHistory(client,current,pair,plan.expectedHistory)
   const receipt=current.periods.find(p=>p.id===plan.periodId)
   if(receipt){
     requireState(receipt.status==='active'&&receipt.trainer_id===pair.trainerId,'restored_period_ended')
     requireState(current.periods.filter(p=>p.status==='active').length===1,'other_trainer')
     requireState(current.memberships.some(m=>m.client_id===current.card.id),'restored_membership_missing')
     requireState(fingerprint(current.history)===fingerprint(plan.state.history),'history_changed_since_restore')
     if(plan.expectedHistory)requireState(fingerprint(current.finance)===fingerprint(plan.state.finance),'finance_changed_since_restore')
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
   const after=await readRestoreState(client,pair,Boolean(plan.expectedHistory))
   if(plan.expectedHistory)await checkExpectedRestoreHistory(client,after,pair,plan.expectedHistory)
   requireState(fingerprint(after.history)===fingerprint(current.history),'history_changed')
   if(plan.expectedHistory)requireState(fingerprint(after.finance)===fingerprint(current.finance),'finance_changed')
   requireState(fingerprint(after.card)===fingerprint(current.card)&&fingerprint(after.source)===fingerprint(current.source)
     &&fingerprint(after.profiles)===fingerprint(current.profiles)&&fingerprint(after.merges)===fingerprint(current.merges),'protected_state_changed')
   requireState(after.periods.length===current.periods.length+1&&current.periods.every(p=>
     after.periods.some(a=>fingerprint(a)===fingerprint(p)))&&after.periods.filter(p=>p.status==='active').length===1,'periods_changed')
   requireState(current.memberships.every(m=>after.memberships.some(a=>fingerprint(a)===fingerprint(m)))
     &&after.memberships.some(m=>m.client_id===current.card.id),'memberships_changed')
   // Pure permission reads under the trainer claim, never a fabricated session/write API.
   await client.query("select set_config('request.jwt.claim.sub',$1,true)",[pair.trainerId])
   const overview=(await client.query('select done_count from public.list_client_overviews(false) where id=$1',[current.card.id])).rows
   if(plan.expectedHistory){
     const visible=(await client.query('select count(*)::int count from public.workouts where id=any($1::uuid[]) and public.can_read_workout(id)',[plan.expectedHistory.workoutIds])).rows[0]?.count
     requireState(overview.length===1&&visible===plan.expectedHistory.workouts,'visibility')
   }else requireState(overview.length===1&&overview[0].done_count===current.groups[0].count,'visibility')
   await client.query('commit')
   return {event:'client_restore_applied',replayed:false,newPeriods:1,historyUnchanged:true,done:overview[0].done_count}
 }catch(error){await client.query('rollback');throw error}
}

export async function verifyClientRestore(runtime,plan){
 if(plan?.schema===3)return verifyCardMergeRuntime(runtime,plan)
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
   requireState(rows.length===1&&count===rows[0].done_count
     &&(plan.expectedHistory||rows[0].done_count===plan.state.groups[0].count),'runtime_visibility')
   let bothActors={}
   if(plan.expectedHistory){
     const expected=readExpectedRestoreHistory(plan.expectedHistory)
     requireState(plan.expectedBinding===fingerprint({pair:plan.pair,state:plan.state,expectedHistory:expected}),'expected_binding')
     requireState(countsMatch(await importedCounts(runtime,expected),expected),'trainer_imported_visibility')
     await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[plan.pair.athleteId])
     const own=(await runtime.query(`select auth_user_id=$2 owns_card,
       exists(select 1 from public.client_trainer_relationships where id=$3 and client_id=$1 and trainer_id=$4 and status='active') active_trainer
       from public.clients where id=$1`,[expected.clientId,plan.pair.athleteId,plan.periodId,plan.pair.trainerId])).rows[0]
     requireState(own?.owns_card&&own.active_trainer,'athlete_connection')
     // The application uses this protected read model; direct trainer/profile
     // table reads are intentionally narrower and must not be granted here.
     const trainers=(await runtime.query('select trainer_id from public.list_accessible_client_trainers() where client_id=$1',[expected.clientId])).rows
     requireState(trainers.length===1&&trainers[0].trainer_id===plan.pair.trainerId,'athlete_trainer_visibility')
     requireState(countsMatch(await importedCounts(runtime,expected),expected),'athlete_imported_visibility')
     bothActors={athleteCanReadCanonical:true,athleteCanReadTrainer:true,bothCanReadImported:true}
   }
   await runtime.query('commit')
   return {event:'client_restore_verified',readOnly:true,restoredPeriodActive:true,canonicalMembership:true,trainerCanReadCanonical:true,...bothActors,done:count}
 }catch(error){await runtime.query('rollback');throw error}
}

async function verifyCardMergeRuntime(runtime,plan){
 validateCardMergePlan(plan)
 const expected={...plan.expectedHistory,clientId:plan.targetId}
 await runtime.query('begin transaction isolation level repeatable read read only')
 try{
   const role=(await runtime.query(`select current_user username,current_setting('transaction_read_only') readonly,
     rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
   requireState(role?.username==='fit_api'&&role.readonly==='on'&&!role.rolsuper&&!role.rolbypassrls,'runtime_role')
   await runtime.query("set local statement_timeout='10s'")
   await runtime.query("set local lock_timeout='2s'")
   for(const actor of [plan.pair.trainerId,plan.currentId]){
     await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[actor])
     const card=(await runtime.query(`select auth_user_id,trainer_id,archived_at,merged_into_client_id
       from public.clients where id=$1`,[plan.targetId])).rows
     requireState(card.length===1&&card[0].auth_user_id===plan.currentId&&card[0].trainer_id===plan.pair.trainerId
       &&!card[0].archived_at&&!card[0].merged_into_client_id,'merge_runtime_card')
     const links=(await runtime.query(`select trainer_id from public.list_accessible_client_trainers() where client_id=$1`,[plan.targetId])).rows
     requireState(links.length===1&&links[0].trainer_id===plan.pair.trainerId,'merge_runtime_trainer')
     const period=(await runtime.query(`select id from public.client_trainer_relationships where id=$1
       and client_id=$2 and trainer_id=$3 and status='active'`,[plan.periodId,plan.targetId,plan.pair.trainerId])).rows
     requireState(period.length===1,'merge_runtime_period')
     requireState(countsMatch(await importedCounts(runtime,expected),expected),'merge_runtime_history')
     if(actor===plan.pair.trainerId){
       const views=(await runtime.query('select id from public.list_client_overviews(false) where id=$1',[plan.targetId])).rows
       requireState(views.length===1,'merge_runtime_overview')
     }
   }
   await runtime.query('commit')
   return {event:'client_restore_verified',readOnly:true,restoredPeriodActive:true,canonicalMembership:true,
     trainerCanReadCanonical:true,athleteCanReadCanonical:true,athleteCanReadTrainer:true,bothCanReadImported:true}
 }catch(error){await runtime.query('rollback');throw error}
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
     const pair=readRestoreTarget(process.env.FIT_CLIENT_RESTORE_TARGETS)
     const plan=await planClientRestore(client,pair);plan.requestedBy=process.env.GITHUB_ACTOR
     await writeFile(planPath,JSON.stringify(plan),{flag:'wx',mode:0o600});console.log(JSON.stringify(plan.report))
   }else{
     const plan=JSON.parse(await readFile(planPath,'utf8'))
     if(phase==='verify'&&plan.schema===3){
       const ownerConfig=buildDatabaseConnectionConfig('MIGRATION_DATABASE')
       requireState(ownerConfig.host==='10.70.10.67'&&ownerConfig.port===5432&&ownerConfig.database==='fit'
         &&ownerConfig.user==='fit_owner'&&process.env.MIGRATION_DATABASE_SSL_MODE==='require','environment')
       const owner=new Client({...ownerConfig,connectionTimeoutMillis:5000,query_timeout:15000})
       await owner.connect()
       try{await verifyConfirmedCardMergeOwner(owner,plan)}finally{await owner.end()}
     }
     const result=phase==='apply'?await applyClientRestore(client,plan,{backupVerified:process.env.RESTORE_BACKUP_VERIFIED==='true'}):await verifyClientRestore(client,plan)
     await writeFile(`/repair/${phase}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}.json`,JSON.stringify({at:new Date().toISOString(),operator:process.env.GITHUB_ACTOR,result}),{flag:'wx',mode:0o600})
     // Private Cloud.ru input keeps customer counts/results in the protected
     // server receipt. Actions receives only technical completion flags.
     console.log(JSON.stringify(plan.expectedHistory?privateRestoreTechnicalResult(result):result))
   }
 }finally{await client.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 console.error(/^client_restore_[a-z_]+$/.test(error?.message)?error.message:'client_restore_failed');process.exitCode=1
})
