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
 return {proof,invitation,currentId,profiles,cards,sources,periods,memberships,groups,cardData,authorship,chats,
   importedCounts:await importedCounts(client,expected),writePlanReady:false}
}

async function readImportedAccessState(client,trainerId,scope){
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
   results.push({code:item.code,originalProfileId:item.profileId,expectedHistory:item.expectedHistory,
     chain,sources,card,owner,periods,memberships,identityEvidence,importedAtCanonical:counts,
     importedHistoryMatches:countsMatch(counts,item.expectedHistory),
     nativeOwnerPresent:owner?.yandex_identities===1,
     trainerOwnJournal:item.journalKind==='trainer_self',cardUnclaimed:card.auth_user_id===null,
     trainerSelfNamespaceMatches:item.journalKind!=='trainer_self'||(card.trainer_id===trainerId&&[null,trainerId].includes(card.auth_user_id)),
     sameNameInvitationsAreNotIdentityProof:true,actorSelected:false,writePlanReady:false})
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

export async function planClientRestore(client,pair,expectedHistory=null,currentProfileEvidence=null,confirmedInvitation=null,importedAccessAudit=null){
 if(expectedHistory)readExpectedRestoreHistory(expectedHistory)
 if(currentProfileEvidence){readCurrentProfileEvidence(currentProfileEvidence);readExpectedRestoreHistory(expectedHistory)}
 if(confirmedInvitation){readConfirmedRestoreInvitation(confirmedInvitation);readExpectedRestoreHistory(expectedHistory)
   requireState(!currentProfileEvidence,'conflicting_evidence')}
 if(importedAccessAudit){readImportedAccessAudit(importedAccessAudit);readExpectedRestoreHistory(expectedHistory)
   requireState(!currentProfileEvidence,'conflicting_evidence')}
 let privateDiagnostic
 await client.query('begin transaction isolation level repeatable read read only')
 try{
   await ownerGate(client)
   if(importedAccessAudit){
     privateDiagnostic={pair,expectedHistory,importedAccessAudit:await readImportedAccessState(client,pair.trainerId,importedAccessAudit)}
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
