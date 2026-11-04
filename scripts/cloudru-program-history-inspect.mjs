import {createHash,timingSafeEqual} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {reviewedProgramPackets} from './private-program-history-scopes.mjs'
import {resolveJournalTrainer,ownerRead,sourceContent,sealJournalReceipt,legacyProfileId} from './cloudru-journal-import.mjs'
import {safeJournalUploadFailure} from './cloudru-journal-upload.mjs'

// This phase has no writer, mutation adapter, actor/client override or apply mode.
const fail = code => {throw new Error(`program_history_inspect_${code}`)}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function readProgramPacket(parts,approvedSha256,readRequest,scopes=reviewedProgramPackets) {
  try {
    if(!Array.isArray(parts)||parts.length!==2||parts.some(p=>typeof p!=='string'||p.length<1||p.length>47000)
      ||!/^[a-f0-9]{64}$/u.test(approvedSha256??''))fail('packet_invalid')
    const encoded=parts.join(''),bytes=Buffer.from(encoded,'base64')
    if(bytes.toString('base64')!==encoded)fail('packet_invalid')
    const raw=gunzipSync(bytes,{maxOutputLength:2*1024*1024})
    if(!timingSafeEqual(createHash('sha256').update(raw).digest(),Buffer.from(approvedSha256,'hex')))fail('packet_invalid')
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))
    const scope=scopes.find(s=>s.sha256===approvedSha256&&s.code===payload.code)
    if(!scope||payload.schemaVersion!==4||Object.keys(payload).sort().join(',')!=='batchId,clientName,code,matchNames,schemaVersion,workouts'
      ||payload.batchId!==`program-history-20261103-${scope.code.toLowerCase()}`
      ||typeof payload.clientName!=='string'||payload.clientName.length<2||payload.clientName.length>120||payload.clientName.trim()!==payload.clientName
      ||!Array.isArray(payload.matchNames)||payload.matchNames.length<1||payload.matchNames.length>3
      ||new Set(payload.matchNames).size!==payload.matchNames.length||!payload.matchNames.includes(payload.clientName)
      ||payload.matchNames.some(n=>typeof n!=='string'||n.length<2||n.length>120||n!==n.trim()||/[\u0000-\u001f\u007f]/u.test(n))
      ||!Array.isArray(payload.workouts)||payload.workouts.length!==scope.workouts)fail('packet_invalid')
    let previous='',exercises=0,sets=0;const requests=new Set()
    for(const input of payload.workouts) {
      if(!input||input.id!=null||input.clientId!=null||!uuid.test(input.requestId??'')||requests.has(input.requestId)
        ||input.trainingFormat!==scope.trainingFormat||input.startTime!==null||input.endTime!==null||input.actualDurationSec!==null
        ||input.stageId!=null||input.favoriteTitle!=null||input.prepSeconds!==undefined||input.executionMode!==undefined
        ||input.workoutDate<previous||input.workoutDate<scope.from||input.workoutDate>scope.to
        ||!Array.isArray(input.exercises)||input.exercises.length<1||input.exercises.length>60
        ||input.exercises.some(e=>e.source!=='system'||e.customExerciseId!=null||e.sourceExerciseId!=null
          ||!Array.isArray(e.sets)||e.sets.length>100||e.sets.some(s=>s.sourceSetId!=null)))fail('packet_invalid')
      const parsed=readRequest({...input,clientId:'00000000-0000-4000-8000-000000000001'},null)
      if(!parsed||parsed.expectedVersion!==null||!same(sourceContent(input),sourceContent(parsed.draft)))fail('parser_mismatch')
      requests.add(input.requestId);previous=input.workoutDate;exercises+=input.exercises.length
      sets+=input.exercises.reduce((n,e)=>n+e.sets.length,0)
    }
    if(exercises!==scope.exercises||sets!==scope.sets||payload.workouts[0].workoutDate!==scope.from||previous!==scope.to)fail('packet_invalid')
    return {payload,scope}
  } catch {fail('packet_invalid')}
}

const setMetrics=s=>[s.weightKg,s.reps,s.durationMin,s.durationSec,s.distanceKm,s.rpe]
const metric=v=>v===null||v===undefined?null:Number(v)
export function compareProgramHistory(workouts,graph) {
  const result={newRecords:[],exactDuplicates:[],conflicts:[]}
  for(const draft of workouts) {
    const names=draft.exercises.map(e=>e.name.trim())
    const sameComposition=graph.workouts.filter(w=>w.deleted_at===null&&w.workout_date===draft.workoutDate)
      .filter(w=>same(graph.exercises.filter(e=>e.workout_id===w.id).sort((a,b)=>a.position-b.position).map(e=>e.exercise_name.trim()),names))
    if(!sameComposition.length){result.newRecords.push(draft.requestId);continue}
    const exact=sameComposition.filter(w=>{
      if(w.status!=='done'||w.training_format!==draft.trainingFormat)return false
      const actual=graph.exercises.filter(e=>e.workout_id===w.id).sort((a,b)=>a.position-b.position)
      return actual.every((e,i)=>{
        const expected=draft.exercises[i],sets=graph.sets.filter(s=>s.workout_exercise_id===e.id).sort((a,b)=>a.position-b.position)
        return (e.trainer_comment??null)===(expected.trainerComment??null)&&sets.length===expected.sets.length&&sets.every((s,j)=>
          typeof s.confirmed_at==='string'&&same(['weight_kg','reps','duration_min','duration_sec','distance_km','rpe'].map(k=>metric(s[`fact_${k}`])),setMetrics(expected.sets[j])))
      })
    })
    if(exact.length===1&&sameComposition.length===1)result.exactDuplicates.push({requestId:draft.requestId,workoutId:exact[0].id})
    else result.conflicts.push({requestId:draft.requestId,workoutIds:sameComposition.map(w=>w.id)})
  }
  return result
}

export async function readProgramCardCandidates(connection,trainerId,payload) {
    const rows=(await connection.query(`select distinct c.id,c.full_name,c.trainer_id,c.auth_user_id,c.archived_at,c.merged_into_client_id,ct.alias,
      (c.trainer_id=$1 and c.auth_user_id is null or exists(select 1 from public.client_trainer_relationships r where r.client_id=c.id and r.trainer_id=$1 and r.status='active')) connected,
      (lower(btrim(c.full_name)) in (select lower(btrim(n)) from unnest($2::text[]) n)
        or lower(btrim(ct.alias)) in (select lower(btrim(n)) from unnest($2::text[]) n)) exact,
      (exists(select 1 from regexp_split_to_table(lower(btrim(c.full_name)),E'\\\\s+') token
        where token in (select lower(btrim(n)) from unnest($3::text[]) n))) possible
      from public.clients c left join public.client_trainers ct on ct.client_id=c.id and ct.trainer_id=$1
      where c.trainer_id=$1 or ct.trainer_id=$1 or exists(select 1 from public.client_trainer_relationships r where r.client_id=c.id and r.trainer_id=$1)
      order by c.id limit 1001`,[trainerId,payload.matchNames,payload.clientName.split(/\s+/u)])).rows
    if(rows.length>1000)fail('roster_too_large')
    return rows
}

export async function inspectProgramHistory({owner,runtime,target,legacyId=null,parts,approvedSha256,readRequest,persistInspection,scopes=reviewedProgramPackets}) {
  const {payload,scope}=readProgramPacket(parts,approvedSha256,readRequest,scopes)
  if(typeof persistInspection!=='function')fail('private_receipt_required')
  const {trainerId}=await resolveJournalTrainer(owner,target,legacyId)
  const cards=await ownerRead(owner,()=>readProgramCardCandidates(owner,trainerId,payload))
  const exact=cards.filter(c=>c.exact),possible=cards.filter(c=>c.possible)
  const selected=exact.length===1&&exact[0].connected===true&&exact[0].archived_at===null&&exact[0].merged_into_client_id===null?exact[0]:null
  let status=selected?'existing_ready':exact.length||possible.length?'selection_requires_review':'new_card_ready'
  const graph={workouts:[],exercises:[],sets:[]}
  if(selected) await ownerRead(owner,async()=>{
    graph.workouts=(await owner.query(`select to_jsonb(w)||jsonb_build_object('workout_date',w.workout_date::text) value from public.workouts w where client_id=$1 order by id limit 5001`,[selected.id])).rows.map(r=>r.value)
    graph.exercises=(await owner.query(`select to_jsonb(e) value from public.workout_exercises e join public.workouts w on w.id=e.workout_id where w.client_id=$1 order by e.id limit 20001`,[selected.id])).rows.map(r=>r.value)
    graph.sets=(await owner.query(`select to_jsonb(s) value from public.workout_sets s join public.workout_exercises e on e.id=s.workout_exercise_id join public.workouts w on w.id=e.workout_id where w.client_id=$1 order by s.id limit 100001`,[selected.id])).rows.map(r=>r.value)
    if(graph.workouts.length>5000||graph.exercises.length>20000||graph.sets.length>100000)fail('history_too_large')
  })
  // Independently verify visibility/partition through the actual trainer actor.
  if(selected) {
    await runtime.query('begin transaction isolation level repeatable read read only')
    try {
      await runtime.query("set local statement_timeout='15s'")
      const role=(await runtime.query(`select current_setting('transaction_read_only') readonly,current_user name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
      if(role?.readonly!=='on'||role.name!=='fit_api'||role.rolsuper!==false||role.rolbypassrls!==false)fail('runtime_role_invalid')
      await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[trainerId])
      const visible=(await runtime.query('select id,trainer_id,auth_user_id from public.clients where id=$1',[selected.id])).rows
      const rows=(await runtime.query(`select id from public.workouts where client_id=$1 order by id limit 5001`,[selected.id])).rows
      if(visible.length!==1||visible[0].trainer_id!==selected.trainer_id||visible[0].auth_user_id!==selected.auth_user_id
        ||!same(rows.map(w=>w.id),graph.workouts.map(w=>w.id)))fail('visibility_changed')
      await runtime.query('commit')
    } catch(error){await runtime.query('rollback');throw error}
  }
  const comparison=compareProgramHistory(payload.workouts,graph)
  if(comparison.conflicts.length)status='history_requires_review'
  if(comparison.exactDuplicates.length)status='duplicates_require_manifest_review'
  const receipt={kind:'program_history_inspection',readOnly:true,accountRole:'trainer',code:scope.code,trainerId,selected,candidates:cards.filter(c=>c.exact||c.possible),graph,comparison,graphFingerprint:sha(graph)}
  await persistInspection(receipt)
  return {event:'program_history_inspection',code:scope.code,status,readOnly:true,productionMutated:false,trainerVerified:true,
    exactCards:exact.length,potentialCards:possible.length,existingWorkouts:graph.workouts.length,
    newWorkouts:comparison.newRecords.length,duplicates:comparison.exactDuplicates.length,conflicts:comparison.conflicts.length}
}

async function main() {
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='podkolzinpd/fit'||process.env.FIT_JOURNAL_IMPORT_MODE!=='inspect')fail('source_invalid')
  const {readWorkoutHistoryTarget,readHistoryRegistry}=await import('./cloudru-account-history-audit.mjs')
  const target=readWorkoutHistoryTarget(process.env.FIT_WORKOUT_HISTORY_TARGET)
  const {loadCloudruUpload}=await import('./cloudru-journal-upload.mjs')
  const upload=await loadCloudruUpload(target,process.env.FIT_JOURNAL_IMPORT_SHA256,process.env.FIT_JOURNAL_UPLOAD_SESSION)
  const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
  if(process.env.DATABASE_URL||process.env.MIGRATION_DATABASE_URL)fail('database_target_invalid')
  const ownerConfig=buildDatabaseConnectionConfig('MIGRATION_DATABASE'),runtimeConfig=buildDatabaseConnectionConfig('DATABASE')
  for(const [config,user,ssl] of [[ownerConfig,'fit_owner',process.env.MIGRATION_DATABASE_SSL_MODE],[runtimeConfig,'fit_api',process.env.DATABASE_SSL_MODE]]) {
    if(config?.host!=='10.70.10.67'||config.port!==5432||config.database!=='fit'||config.user!==user||ssl!=='require')fail('database_target_invalid')
  }
  const {readSavePlannedWorkoutRequest}=await import('/app/dist/planned-workout-request.js')
  const {Client}=createRequire('/app/package.json')('pg')
  const owner=new Client({...ownerConfig,connectionTimeoutMillis:5000,query_timeout:15000}),runtime=new Client({...runtimeConfig,connectionTimeoutMillis:5000,query_timeout:20000})
  let interrupted=false;owner.on('error',()=>{interrupted=true});runtime.on('error',()=>{interrupted=true})
  try {
    await owner.connect();await runtime.connect()
    const legacyId=await legacyProfileId(process.env,target,readHistoryRegistry)
    const result=await inspectProgramHistory({owner,runtime,target,legacyId,parts:upload.parts,approvedSha256:process.env.FIT_JOURNAL_IMPORT_SHA256,
      readRequest:readSavePlannedWorkoutRequest,persistInspection:receipt=>upload.persistReceipt('readback',receipt,sealJournalReceipt)})
    if(interrupted)fail('connection_interrupted')
    console.log(JSON.stringify(result))
  }finally{await Promise.allSettled([owner.end(),runtime.end()]);upload.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  // No SQL/server message, names, IDs, target hashes or private graph in logs.
  const codes=new Set(['packet_invalid','private_receipt_required','roster_too_large','history_too_large','runtime_role_invalid','visibility_changed','source_invalid','database_target_invalid','connection_interrupted',
    'trainer_ambiguous','current_trainer_identity_required','trainer_role_invalid','target_invalid','readonly_required',
    'legacy_registry_unavailable','legacy_registry_too_large','legacy_registry_invalid','legacy_registry_config_missing','legacy_registry_credential_missing'])
  const message=error instanceof Error?error.message:''
  const prefix=['program_history_inspect_','journal_import_'].find(value=>message.startsWith(value))
  const code=prefix?message.slice(prefix.length):''
  console.error(JSON.stringify({event:'program_history_inspection_failed',code:codes.has(code)?code:'failed',...safeJournalUploadFailure(error)}));process.exitCode=1
})
