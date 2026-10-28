import {createHash,createCipheriv,createPublicKey,publicEncrypt,randomBytes,constants,timingSafeEqual} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'

// One owner-approved private journal, manual trusted-main operation only.
// No app endpoint, schema change, identity mutation or generic actor/client input.
const failTransport=()=>{throw new Error('journal_import_private_payload_invalid')}
export function readJournalTransport(parts,approvedSha256,targetNameSha256) {
 try {
  if(!Array.isArray(parts)||parts.length!==2||parts.some(p=>typeof p!=='string'||p.length<1||p.length>47000)
   ||![approvedSha256,targetNameSha256].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)))failTransport()
  const encoded=parts.join('')
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))failTransport()
  const compressed=Buffer.from(encoded,'base64')
  if(compressed.toString('base64')!==encoded)failTransport()
  const raw=gunzipSync(compressed,{maxOutputLength:2*1024*1024})
  if(!timingSafeEqual(createHash('sha256').update(raw).digest(),Buffer.from(approvedSha256,'hex')))failTransport()
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))
  if(!data||Object.keys(data).sort().join(',')!=='batchId,clientName,schemaVersion,workouts'
   ||data.schemaVersion!==1||typeof data.batchId!=='string'||!/^[a-z0-9][a-z0-9:_-]{0,99}$/i.test(data.batchId)
   ||typeof data.clientName!=='string'||data.clientName.length<2||data.clientName.length>120
   ||/[\u0000-\u001f\u007f]/.test(data.clientName)||data.clientName!==data.clientName.trim()
   ||createHash('sha256').update(data.clientName.toLowerCase()).digest('hex')!==targetNameSha256
   ||!Array.isArray(data.workouts)||data.workouts.length!==137
   ||!data.workouts.every(w=>w.trainingFormat==='with_trainer')
   ||data.workouts.reduce((n,w)=>n+w.exercises.length,0)!==641
   ||data.workouts.reduce((n,w)=>n+w.exercises.reduce((m,e)=>m+e.sets.length,0),0)!==240)failTransport()
  return data
 } catch { failTransport() }
}

const identityUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const failIdentity=code=>{throw new Error('journal_import_'+code)}
async function resolveJournalTrainer(owner,target,legacyId=null) {
 if(!target||![target.trainerLoginSha256,target.trainerEmailSha256].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))
  ||(legacyId!==null&&!identityUuid.test(legacyId)))failIdentity('target_invalid')
 await owner.query('begin transaction isolation level repeatable read read only')
 try {
  await owner.query("set local statement_timeout='10s'")
  const mode=(await owner.query("select current_setting('transaction_read_only') mode")).rows[0]?.mode
  if(mode!=='on')failIdentity('readonly_required')
  const candidates=(await owner.query(`select distinct profile_id from (
   select profile_id from app_private.fit_lime_pilot_allowlist where login_sha256=any($1::text[])
   union select profile_id from app_private.trainer_schedule_v2_allowlist where login_sha256=any($1::text[])
   union select profile_id from app_private.nutrition_native_bindings where login_sha256=any($1::text[])
   ) matched where profile_id is not null limit 3`,[[...new Set([target.trainerLoginSha256,target.trainerEmailSha256])]])).rows
  if(candidates.length>1||(legacyId&&candidates.some(c=>c.profile_id!==legacyId)))failIdentity('trainer_ambiguous')
  const trainerId=candidates[0]?.profile_id??legacyId
  if(!identityUuid.test(trainerId??''))failIdentity('current_trainer_identity_required')
  const rows=(await owner.query(`select p.account_role,exists(select 1 from app_private.auth_identities i
   where i.profile_id=p.id and i.provider='yandex') linked from public.profiles p where p.id=$1`,[trainerId])).rows
  if(rows.length!==1||rows[0].account_role!=='trainer')failIdentity('trainer_role_invalid')
  if(rows[0].linked!==true)failIdentity('current_trainer_identity_required')
  await owner.query('commit')
  return {trainerId,retainedLoginBinding:candidates.length===1,yandexIdentityLinked:true}
 }catch(e){await owner.query('rollback');throw e}
}


const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const failWriter=code=>{throw new Error('journal_import_'+code)}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Detect an older deployed parser silently dropping a supplied source field.
function sourceContent(d) {
 const exerciseKeys=['position','source','ref','customExerciseId','name','muscleGroup','inputKind','blockId','blockType',
  'blockPreset','blockRounds','restBetweenExercisesSec','restBetweenRoundsSec','restBetweenSetsSec','trainerComment']
 const setKeys=['position','weightKg','reps','durationMin','durationSec','distanceKm','rpe','metricSources']
 return [d.workoutDate,d.notes?.trim()??null,d.title?.trim()??null,d.trainingFormat??null,
  d.exercises.map(e=>[...exerciseKeys.map(k=>e[k]??null),e.sets.map(s=>setKeys.map(k=>k==='metricSources'
   ?s.metricSources?['duration','distance','rpe'].map(key=>s.metricSources[key]??null):null
   :s[k]??null))])]
}

export function validateJournalDrafts(workouts,clientId,readRequest) {
 if(!uuid.test(clientId)||!Array.isArray(workouts)||workouts.length!==137)failWriter('scope_invalid')
 const seen=new Set();let previous='';
 return workouts.map((input,index)=>{
  if(!input||input.id!=null||!uuid.test(input.requestId??'')||seen.has(input.requestId)
   ||input.stageId!=null||input.favoriteTitle!=null||input.startTime!=null||input.endTime!=null
   ||input.actualDurationSec!=null||input.prepSeconds!==undefined||input.executionMode!==undefined
   ||!Array.isArray(input.exercises)||input.exercises.length>60
   ||input.exercises.some(e=>e.source!=='system'||e.customExerciseId!=null||e.sourceExerciseId!=null
    ||!Array.isArray(e.sets)||e.sets.length>100||e.sets.some(s=>s.sourceSetId!=null)))failWriter('draft_invalid')
  seen.add(input.requestId)
  const parsed=readRequest({...input,clientId},null)
  if(!parsed||parsed.expectedVersion!==null||parsed.draft.id!==null)failWriter('request_invalid')
  const draft=parsed.draft
  if(JSON.stringify(sourceContent(input))!==JSON.stringify(sourceContent(draft)))failWriter('parser_would_drop_source_data')
  if(draft.workoutDate<'2025-08-17'||draft.workoutDate>'2026-10-27'||draft.workoutDate<previous)failWriter('dates_invalid')
  previous=draft.workoutDate
  return {ordinal:index+1,draft}
 })
}

// The runner must resolve these IDs from the separately approved target secret,
// never accept actor/client IDs or SQL through workflow inputs. readState reads
// only this card using a distinct owner READ ONLY transaction. No owner writes.
async function insertReviewedJournal({runtime,trainerId,clientId,athleteId,workouts,
 readRequest,saveCompleted,readState,persistReceipt,newCard=null,verifyContent=null}) {
 if(!uuid.test(trainerId)||(newCard===null&&!uuid.test(clientId))||(athleteId!==null&&!uuid.test(athleteId)))failWriter('selection_invalid')
 if(newCard && (clientId!==null||athleteId!==null||typeof newCard.draft?.fullName!=='string'
  ||Object.keys(newCard.draft).some(k=>!['fullName','gender','ageYears','ageUpdatedAt','heightCm','goal','note'].includes(k))
  ||Object.entries(newCard.draft).some(([k,v])=>k!=='fullName'&&v!==null)))failWriter('new_card_invalid')
 let entries=validateJournalDrafts(workouts,clientId??'00000000-0000-4000-8000-000000000001',readRequest)
 let createdCard=false
 let commitAttempted=false;let transactionOpen=false
 try {
  await runtime.query('begin transaction isolation level serializable');transactionOpen=true
  await runtime.query("set local statement_timeout='15s'")
  await runtime.query("set local lock_timeout='2s'")
  const role=(await runtime.query(`select current_user name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
  if(role?.name!=='fit_api'||role.rolsuper!==false||role.rolbypassrls!==false)failWriter('runtime_role_invalid')
  await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[trainerId])
  const actor=(await runtime.query('select account_role from public.profiles where id=$1',[trainerId])).rows[0]
  if(actor?.account_role!=='trainer')failWriter('trainer_role_invalid')
  const locked=(await runtime.query('select pg_try_advisory_xact_lock(670,hashtext($1)) locked',[newCard?trainerId:clientId])).rows[0]
  if(locked?.locked!==true)failWriter('busy')
  if(newCard) {
   const prior=await newCard.readBatch({trainerId,requestIds:entries.map(e=>e.draft.requestId)})
   if(prior!==null&&!uuid.test(prior))failWriter('prior_batch_invalid')
   if(prior) clientId=prior
   else {
    const named=(await runtime.query(`select id from public.clients where trainer_id=$1
     and lower(btrim(full_name))=lower(btrim($2)) limit 2`,[trainerId,newCard.draft.fullName])).rows
    if(named.length)failWriter('existing_name_requires_review')
    const result=await newCard.create({query:async(sql,args)=>(await runtime.query(sql,args)).rows},newCard.draft)
    if(!uuid.test(result?.id??''))failWriter('new_card_postcondition_failed')
    clientId=result.id;createdCard=true
   }
   entries=validateJournalDrafts(workouts,clientId,readRequest)
  }
  const card=(await runtime.query(`select id,trainer_id,full_name,auth_user_id,archived_at,merged_into_client_id
   from public.clients where id=$1`,[clientId])).rows
  if(card.length!==1||card[0].archived_at!==null||card[0].merged_into_client_id!==null
   ||card[0].auth_user_id!==athleteId
   ||(newCard&&(card[0].trainer_id!==trainerId||card[0].full_name!==newCard.draft.fullName)))failWriter('selection_changed')
  const before=await readState({trainerId,clientId,requestIds:entries.map(e=>e.draft.requestId)})
  if(!Array.isArray(before.workouts)||before.workouts.length>5000||!Array.isArray(before.requests)
   ||before.requests.length>137||before.workouts.some(w=>w.client_id!==clientId))failWriter('state_invalid')
  if(createdCard&&before.workouts.length)failWriter('new_card_postcondition_failed')
  const priorIds=new Set(before.workouts.map(w=>w.id));const priorRequests=new Map(before.requests.map(r=>[r.request_id,r.workout_id]))
  if(priorRequests.size!==before.requests.length)failWriter('receipt_invalid')
  const created=[];let replayed=false
  if(priorRequests.size) {
   if(priorRequests.size!==137)failWriter('partial_prior_batch')
   for(const {ordinal,draft} of entries) {
    const id=priorRequests.get(draft.requestId)
    const prior=before.workouts.find(w=>w.id===id)
    if(!prior||prior.client_id!==clientId||prior.created_by!==trainerId||prior.deleted_at!==null||prior.status!=='done'
     ||prior.workout_date!==draft.workoutDate||prior.notes!==draft.notes)failWriter('prior_batch_changed')
    created.push({ordinal,workoutId:id,requestId:draft.requestId,workoutDate:prior.workout_date})
   }
   replayed=true
  } else {
   const dates=new Set(entries.map(e=>e.draft.workoutDate))
   if(before.workouts.some(w=>dates.has(w.workout_date)))failWriter('existing_date_requires_review')
   const adapter={query:async(sql,args)=>(await runtime.query(sql,args)).rows}
   for(const {ordinal,draft} of entries) {
    const saved=await saveCompleted(adapter,draft,null)
    if(!saved||!uuid.test(saved.id)||priorIds.has(saved.id)||created.some(e=>e.workoutId===saved.id))failWriter('save_postcondition_failed')
    const actual=(await runtime.query(`select client_id,created_by,status,workout_date::text workout_date,
     start_time,end_time,actual_duration_sec,notes from public.workouts where id=$1`,[saved.id])).rows[0]
    if(!actual||actual.client_id!==clientId||actual.created_by!==trainerId||actual.status!=='done'
     ||actual.workout_date!==draft.workoutDate||actual.start_time!==null||actual.end_time!==null
     ||actual.actual_duration_sec!==null||actual.notes!==draft.notes)failWriter('save_postcondition_failed')
    created.push({ordinal,workoutId:saved.id,requestId:draft.requestId,workoutDate:draft.workoutDate,version:saved.version})
   }
  }
  if(createdCard)for(const table of ['trainer_finance_packages','trainer_finance_payments','trainer_finance_sessions']) {
   if((await runtime.query(`select count(*)::int n from public.${table} where client_id=$1`,[clientId])).rows[0]?.n!==0)failWriter('unexpected_finance_change')
  }
  if(verifyContent)await verifyContent(runtime,{trainerId,clientId,entries,created})
  const ids=created.map(e=>e.workoutId)
  const teacherCount=(await runtime.query('select count(*)::int n from public.workouts where id=any($1::uuid[])',[ids])).rows[0]?.n
  if(teacherCount!==137)failWriter('trainer_visibility_failed')
  let athleteCount=null
  if(athleteId) {
   await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[athleteId])
   athleteCount=(await runtime.query('select count(*)::int n from public.workouts where id=any($1::uuid[])',[ids])).rows[0]?.n
   if(athleteCount!==137)failWriter('athlete_visibility_failed')
   await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[trainerId])
  }
  const receipt={schemaVersion:1,trainerId,clientId,athleteId,created,replayed,createdCard,
   previousWorkouts:before.workouts.map(w=>({id:w.id,fingerprint:hash(w)})),teacherCount,athleteCount}
  // Keep a private receipt before commit so unknown outcomes remain reconcilable.
  await persistReceipt('prepared',receipt)
  commitAttempted=true
  await runtime.query('commit');transactionOpen=false
  await persistReceipt('committed',receipt)
  return {status:replayed?'already_imported':'imported',workouts:137,teacherCount,athleteCount}
 } catch(error) {
  if(transactionOpen&&!commitAttempted)await runtime.query('rollback')
  if(commitAttempted)failWriter('outcome_requires_readback')
  if(error instanceof Error&&error.message.startsWith('journal_import_'))throw error
  failWriter('failed_rolled_back')
 }
}

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const metric=v=>v===null?null:Number(v)
const failContent=()=>{throw new Error('journal_import_content_readback_failed')}
async function verifyJournalContent(runtime,{trainerId,clientId,entries,created}) {
 const ids=created.map(x=>x.workoutId)
 if(ids.length!==137||new Set(ids).size!==137)failContent()
 const workouts=(await runtime.query(`select id,client_id,created_by,status,workout_date::text workout_date,
  start_time,end_time,actual_duration_sec,notes,title,deleted_at,training_format from public.workouts where id=any($1::uuid[])`,[ids])).rows
 const exercises=(await runtime.query(`select id,workout_id,position,exercise_source,exercise_ref,custom_exercise_id,
  exercise_name,muscle_group,input_kind,block_id,block_type,block_preset,block_rounds,
  rest_between_exercises_sec,rest_between_rounds_sec,rest_between_sets_sec,trainer_comment
  from public.workout_exercises where workout_id=any($1::uuid[]) order by workout_id,position`,[ids])).rows
 const sets=(await runtime.query(`select s.workout_exercise_id,s.position,s.plan_weight_kg,s.plan_reps,
  s.plan_duration_min,s.plan_duration_sec,s.plan_distance_km,s.plan_rpe,
  s.fact_weight_kg,s.fact_reps,s.fact_duration_min,s.fact_duration_sec,s.fact_distance_km,s.fact_rpe,
  s.fact_duration_source,s.fact_distance_source,s.fact_rpe_source,s.confirmed_at is not null confirmed
  from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id
  where e.workout_id=any($1::uuid[]) order by s.workout_exercise_id,s.position`,[ids])).rows
 if(workouts.length!==137||exercises.length!==entries.reduce((n,e)=>n+e.draft.exercises.length,0)
  ||sets.length!==entries.reduce((n,e)=>n+e.draft.exercises.reduce((m,x)=>m+x.sets.length,0),0))failContent()
 for(const {ordinal,draft} of entries) {
  const id=created.find(c=>c.ordinal===ordinal)?.workoutId
  const actual=workouts.find(w=>w.id===id)
  if(!actual||actual.client_id!==clientId||actual.created_by!==trainerId||actual.status!=='done'
   ||actual.deleted_at!==null||actual.workout_date!==draft.workoutDate||actual.start_time!==null
   ||actual.end_time!==null||actual.actual_duration_sec!==null||actual.notes!==draft.notes
   ||actual.title!==(draft.title??null)||actual.training_format!==(draft.trainingFormat??'self'))failContent()
  const actualExercises=exercises.filter(e=>e.workout_id===id)
  if(actualExercises.length!==draft.exercises.length)failContent()
  for(const e of draft.exercises) {
   const a=actualExercises.find(x=>x.position===e.position)
   if(!a)failContent()
   const values=[a.position,a.exercise_source,a.exercise_ref,a.custom_exercise_id,a.exercise_name,a.muscle_group,
    a.input_kind,a.block_id,a.block_type,a.block_preset,a.block_rounds,a.rest_between_exercises_sec,
    a.rest_between_rounds_sec,a.rest_between_sets_sec,a.trainer_comment]
   if(!equal(values,[e.position,e.source,e.ref,e.customExerciseId,e.name,e.muscleGroup,e.inputKind,e.blockId,
    e.blockType,e.blockPreset,e.blockRounds,e.restBetweenExercisesSec,e.restBetweenRoundsSec,e.restBetweenSetsSec,e.trainerComment]))failContent()
   const actualSets=sets.filter(s=>s.workout_exercise_id===a.id)
   if(actualSets.length!==e.sets.length)failContent()
   for(const set of e.sets) {
    const s=actualSets.find(x=>x.position===set.position)
    if(!s||s.confirmed!==true)failContent()
    const expected=[set.weightKg,set.reps,set.durationMin,set.durationSec,set.distanceKm,set.rpe]
    const plan=[s.plan_weight_kg,s.plan_reps,s.plan_duration_min,s.plan_duration_sec,s.plan_distance_km,s.plan_rpe].map(metric)
    const fact=[s.fact_weight_kg,s.fact_reps,s.fact_duration_min,s.fact_duration_sec,s.fact_distance_km,s.fact_rpe].map(metric)
    if(!equal(expected,plan)||!equal(expected,fact))failContent()
    const provenance=[s.fact_duration_source,s.fact_distance_source,s.fact_rpe_source]
    const sources=set.metricSources??{duration:'unknown',distance:'unknown',rpe:'unknown'}
    if(!equal(provenance,[sources.duration,sources.distance,sources.rpe]))failContent()
   }
  }
 }
 return {workouts:workouts.length,exercises:exercises.length,sets:sets.length,contentVerified:true}
}


export function sealJournalReceipt(receipt,publicPem) {
 if(typeof publicPem!=='string'||publicPem.length>8192
  ||!publicPem.startsWith('-----BEGIN PUBLIC KEY-----\n')||publicPem.includes('PRIVATE KEY'))throw new Error('journal_receipt_key_invalid')
 const publicKey=createPublicKey(publicPem)
 if(publicKey.asymmetricKeyType!=='rsa'||publicKey.asymmetricKeyDetails.modulusLength<2048)throw new Error('journal_receipt_key_invalid')
 const plain=Buffer.from(JSON.stringify(receipt))
 if(plain.length>5*1024*1024)throw new Error('journal_receipt_too_large')
 const key=randomBytes(32),iv=randomBytes(12)
 const cipher=createCipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(Buffer.from('fit-private-journal-receipt-v1'))
 const data=Buffer.concat([cipher.update(plain),cipher.final()])
 return {version:1,algorithm:'RSA-OAEP-SHA256/AES-256-GCM',
  wrappedKey:publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),
  iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}
}

const failOrchestrator=code=>{throw new Error('journal_import_'+code)}
async function ownerRead(owner,work) {
 await owner.query('begin transaction isolation level repeatable read read only')
 try {
  await owner.query("set local statement_timeout='10s'")
  if((await owner.query("select current_setting('transaction_read_only') mode")).rows[0]?.mode!=='on')failOrchestrator('readonly_required')
  const value=await work();await owner.query('commit');return value
 }catch(e){await owner.query('rollback');throw e}
}
export async function runPreparedNewCardImport({mode,owner,runtime,target,legacyId=null,parts,approvedSha256,
 readRequest,saveCompleted,createCard,persistReceipt}) {
 if(!['inspect','apply'].includes(mode))failOrchestrator('mode_invalid')
 const payload=readJournalTransport(parts,approvedSha256,target.clientNameSha256)
 const {trainerId}=await resolveJournalTrainer(owner,target,legacyId)
 const requestIds=validateJournalDrafts(payload.workouts,'00000000-0000-4000-8000-000000000001',readRequest).map(e=>e.draft.requestId)
 let lastBatchRows=[]
 const readBatch=async()=>ownerRead(owner,async()=>{
  const rows=(await owner.query(`select r.request_id,w.id workout_id,w.client_id,c.full_name,c.trainer_id,c.auth_user_id,
   c.archived_at,c.merged_into_client_id from app_private.workout_create_requests r
   left join public.workouts w on w.id=r.workout_id left join public.clients c on c.id=w.client_id
   where r.actor_id=$1 and r.request_id=any($2::uuid[]) limit 138`,[trainerId,requestIds])).rows
  if(!rows.length)return null
  if(rows.length!==137||new Set(rows.map(r=>r.request_id)).size!==137||new Set(rows.map(r=>r.client_id)).size!==1
   ||rows.some(r=>!r.workout_id||r.full_name!==payload.clientName||r.trainer_id!==trainerId
    ||r.auth_user_id!==null||r.archived_at!==null||r.merged_into_client_id!==null))failOrchestrator('prior_batch_changed')
  lastBatchRows=rows
  return rows[0].client_id
 })
 const readState=async({clientId})=>ownerRead(owner,async()=>({
  workouts:(await owner.query(`select id,client_id,created_by,status,workout_date::text workout_date,deleted_at,notes
   from public.workouts where client_id=$1 order by id limit 5001`,[clientId])).rows,
  requests:(await owner.query(`select request_id,workout_id from app_private.workout_create_requests
   where actor_id=$1 and request_id=any($2::uuid[]) limit 138`,[trainerId,requestIds])).rows,
 }))
 const priorCard=await readBatch()
 await runtime.query('begin transaction isolation level repeatable read read only')
 try {
  await runtime.query("set local statement_timeout='15s'")
  await runtime.query("set local lock_timeout='2s'")
  const role=(await runtime.query(`select current_setting('transaction_read_only') readonly,current_user name,
   rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
  if(role?.readonly!=='on'||role.name!=='fit_api'||role.rolsuper!==false||role.rolbypassrls!==false)failOrchestrator('runtime_role_invalid')
  await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[trainerId])
  const matching=(await runtime.query(`select c.id from public.clients c
   left join public.client_trainers ct on ct.client_id=c.id and ct.trainer_id=$1
   where c.archived_at is null and c.merged_into_client_id is null
   and (c.trainer_id=$1 or ct.trainer_id=$1 or exists(select 1 from public.client_trainer_relationships r
    where r.client_id=c.id and r.trainer_id=$1 and r.status='active'))
   and (lower(btrim(c.full_name))=lower($2) or lower(btrim(ct.alias))=lower($2)
    or split_part(lower(btrim(c.full_name)),' ',1)=lower($2)
    or split_part(lower(btrim(ct.alias)),' ',1)=lower($2)) limit 11`,[trainerId,payload.clientName])).rows
  if(matching.length>10||matching.some(c=>c.id!==priorCard))failOrchestrator('existing_name_requires_review')
  if(priorCard)await verifyJournalContent(runtime,{trainerId,clientId:priorCard,
   entries:validateJournalDrafts(payload.workouts,priorCard,readRequest),
   created:lastBatchRows.map(r=>({ordinal:requestIds.indexOf(r.request_id)+1,workoutId:r.workout_id}))})
  await runtime.query('commit')
 }catch(e){await runtime.query('rollback');throw e}
 if(mode==='inspect')return {status:priorCard?'already_imported':'ready',trainerVerified:true,
  willCreateCard:priorCard===null,workouts:137,exercises:641,sets:240,athleteLinked:false,readOnly:true}
 if(typeof persistReceipt!=='function')failOrchestrator('receipt_required')
 let committedReceipt
 const result=await insertReviewedJournal({runtime,trainerId,clientId:null,athleteId:null,workouts:payload.workouts,
  readRequest,saveCompleted,readState,verifyContent:verifyJournalContent,
  newCard:{draft:{fullName:payload.clientName,gender:null,ageYears:null,ageUpdatedAt:null,heightCm:null,goal:null,note:null},
   readBatch,create:createCard},
  persistReceipt:async(state,receipt)=>{await persistReceipt(state,receipt);if(state==='committed')committedReceipt=receipt},
 })
 if(!committedReceipt)failOrchestrator('outcome_requires_readback')
 await runtime.query('begin read only')
 try {
  await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[trainerId])
  const content=await verifyJournalContent(runtime,{trainerId,clientId:committedReceipt.clientId,
   entries:validateJournalDrafts(payload.workouts,committedReceipt.clientId,readRequest),created:committedReceipt.created})
  await runtime.query('commit')
  await persistReceipt('readback',{...committedReceipt,content})
  return {...result,...content,athleteLinked:false}
 }catch {
  await runtime.query('rollback');failOrchestrator('outcome_requires_readback')
 }
}

const failBootstrap=code=>{throw new Error('journal_import_'+code)}
async function boundedGet(url,headers) {
 const result=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!result.ok)failBootstrap('legacy_registry_unavailable')
 const chunks=[];let size=0
 for await(const chunk of result.body){size+=chunk.length;if(size>5*1024*1024)failBootstrap('legacy_registry_too_large');chunks.push(chunk)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{failBootstrap('legacy_registry_invalid')}
}
// Fixed host and bounded registry reader; credentials never leave process memory or logs.
async function legacyProfileId(env,target,readRegistry) {
 const project=env.SUPABASE_PROJECT_ID,token=env.SUPABASE_ACCESS_TOKEN
 if(!/^[a-z0-9]{20}$/.test(project??'')||!token)failBootstrap('legacy_registry_config_missing')
 const keys=await boundedGet(`https://api.supabase.com/v1/projects/${project}/api-keys`,{Authorization:`Bearer ${token}`})
 if(!Array.isArray(keys)||keys.length>20)failBootstrap('legacy_registry_invalid')
 const key=keys.find(k=>k.name==='service_role')?.api_key
 if(typeof key!=='string'||key.length<20)failBootstrap('legacy_registry_credential_missing')
 const rows=await readRegistry(page=>boundedGet(`https://${project}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`,
  {Authorization:`Bearer ${key}`,apikey:key}),[{label:'importTrainer',role:'trainer',emailHash:target.trainerEmailSha256}])
 if(rows.length>1)failBootstrap('trainer_ambiguous')
 return rows[0]?.id??null
}
async function main() {
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='podkolzinpd/fit')failBootstrap('source_invalid')
 const mode=process.env.FIT_JOURNAL_IMPORT_MODE
 if(!['inspect','apply'].includes(mode))failBootstrap('mode_invalid')
 const {readWorkoutHistoryTarget,readHistoryRegistry}=await import('./cloudru-account-history-audit.mjs')
 const target=readWorkoutHistoryTarget(process.env.FIT_WORKOUT_HISTORY_TARGET)
 const {loadCloudruUpload}=await import('./cloudru-journal-upload.mjs')
 const upload=await loadCloudruUpload(target,process.env.FIT_JOURNAL_IMPORT_SHA256,process.env.FIT_JOURNAL_UPLOAD_SESSION)
 readJournalTransport(upload.parts,process.env.FIT_JOURNAL_IMPORT_SHA256,target.clientNameSha256)
 const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
 if(process.env.DATABASE_URL||process.env.MIGRATION_DATABASE_URL)failBootstrap('database_target_invalid')
 const ownerConfig=buildDatabaseConnectionConfig('MIGRATION_DATABASE'),runtimeConfig=buildDatabaseConnectionConfig('DATABASE')
 for(const [config,user,ssl] of [[ownerConfig,'fit_owner',process.env.MIGRATION_DATABASE_SSL_MODE],
  [runtimeConfig,'fit_api',process.env.DATABASE_SSL_MODE]]) {
  if(config?.host!=='10.70.10.67'||config.port!==5432||config.database!=='fit'||config.user!==user||ssl!=='require')failBootstrap('database_target_invalid')
 }
 const {readSavePlannedWorkoutRequest}=await import('/app/dist/planned-workout-request.js')
 const {saveCompletedWorkout}=await import('/app/dist/workout-commands.js')
 const {createClientCard}=await import('/app/dist/domain-commands.js')
 const {Client}=createRequire('/app/package.json')('pg')
 const owner=new Client({...ownerConfig,connectionTimeoutMillis:5000,query_timeout:15000})
 const runtime=new Client({...runtimeConfig,connectionTimeoutMillis:5000,query_timeout:20000})
 // Record asynchronous disconnects without printing private server errors.
 let connectionInterrupted=false
 const interrupted=()=>{connectionInterrupted=true}
 owner.on('error',interrupted);runtime.on('error',interrupted)
 try {
  await owner.connect();await runtime.connect()
  const legacyId=await legacyProfileId(process.env,target,readHistoryRegistry)
  const result=await runPreparedNewCardImport({mode,owner,runtime,target,legacyId,
   parts:upload.parts,
   approvedSha256:process.env.FIT_JOURNAL_IMPORT_SHA256,
   readRequest:readSavePlannedWorkoutRequest,saveCompleted:saveCompletedWorkout,createCard:createClientCard,
   persistReceipt:(state,receipt)=>upload.persistReceipt(state,receipt,sealJournalReceipt),
  })
  if(connectionInterrupted)failBootstrap('outcome_requires_readback')
  // result deliberately contains only fixed statuses/counts, never IDs, text or hashes.
  console.log(JSON.stringify({event:'private_journal_import',...result}))
 }finally{await Promise.allSettled([owner.end(),runtime.end()]);upload.close()}
}
const safeCodes=new Set(['source_invalid','mode_invalid','database_target_invalid','target_invalid',
 'legacy_registry_unavailable','legacy_registry_too_large','legacy_registry_invalid','legacy_registry_config_missing',
 'legacy_registry_credential_missing','trainer_ambiguous','current_trainer_identity_required','trainer_role_invalid',
 'readonly_required','private_payload_invalid','prior_batch_changed','existing_name_requires_review','runtime_role_invalid',
 'receipt_required','receipt_key_invalid','receipt_storage_unavailable','parser_would_drop_source_data','scope_invalid','draft_invalid','request_invalid','dates_invalid','selection_invalid','new_card_invalid',
 'busy','prior_batch_invalid','new_card_postcondition_failed','selection_changed','state_invalid','receipt_invalid',
 'partial_prior_batch','existing_date_requires_review','save_postcondition_failed','unexpected_finance_change',
 'content_readback_failed','trainer_visibility_failed','athlete_visibility_failed','outcome_requires_readback','failed_rolled_back'])
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 main().catch(error=>{
  const suffix=error instanceof Error&&error.message.startsWith('journal_import_')?error.message.slice('journal_import_'.length):''
  console.error(JSON.stringify({event:'private_journal_import_failed',code:safeCodes.has(suffix)?suffix:'failed'}))
  process.exitCode=1
 })
}
