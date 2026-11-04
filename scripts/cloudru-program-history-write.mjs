import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readProgramPacket,inspectProgramHistory,readProgramCardCandidates} from './cloudru-program-history-inspect.mjs'
import {reviewedProgramPackets} from './private-program-history-scopes.mjs'
import {resolveJournalTrainer,ownerRead,validateJournalDrafts,insertReviewedJournal,
  verifyJournalContent,isNewCardFinanceUnchanged,preservedJournalState,verifyPreservedState,legacyProfileId,sealJournalReceipt} from './cloudru-journal-import.mjs'
import {loadCloudruUpload,safeJournalUploadFailure} from './cloudru-journal-upload.mjs'
import {inspectWorkoutHistoryTarget} from './cloudru-account-history-audit.mjs'
import {readRetainedLoginBindings} from './cloudru-account-links-audit.mjs'

const fail=code=>{throw new Error(`program_history_write_${code}`)}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const relevant=cards=>cards.filter(c=>c.exact||c.possible)

async function inspectIdentitySources(owner,target) {
  return ownerRead(owner,async()=>{
    const {tables,bindings}=await readRetainedLoginBindings(owner,[target.trainerEmailSha256,target.trainerLoginSha256])
    const ids=[...new Set(bindings.map(row=>row.profile_id))]
    if(ids.length>10)fail('identity_sources_scope_exceeded')
    const profiles=(await owner.query(`select p.id,p.account_role,exists(select 1 from app_private.auth_identities i
      where i.profile_id=p.id and i.provider='yandex') linked
      from public.profiles p where p.id=any($1::uuid[]) limit 11`,[ids])).rows
    if(profiles.length>10)fail('identity_sources_scope_exceeded')
    return {identityAuditVersion:1,retainedSourcesChecked:tables.length,retainedProfileCandidates:ids.length,
      linkedTrainerCandidates:profiles.filter(p=>p.account_role==='trainer'&&p.linked===true).length,
      retainedBindingSources:[...new Set(bindings.map(row=>row.source))].sort()}
  })
}

async function runtimeRead(runtime,trainerId,work) {
  return ownerRead(runtime,async()=>{
    const role=(await runtime.query(`select current_user name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`)).rows[0]
    if(role?.name!=='fit_api'||role.rolsuper!==false||role.rolbypassrls!==false)fail('runtime_role_invalid')
    await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[trainerId])
    return work()
  })
}

async function batchRows(owner,trainerId,requestIds) {
  return ownerRead(owner,async()=>{
    const rows=(await owner.query(`select r.request_id,w.id workout_id,w.client_id,w.workout_date::text workout_date,
      w.created_by,w.status,w.deleted_at,c.trainer_id,c.auth_user_id,c.archived_at,c.merged_into_client_id
      from app_private.workout_create_requests r left join public.workouts w on w.id=r.workout_id
      left join public.clients c on c.id=w.client_id where r.actor_id=$1 and r.request_id=any($2::uuid[])
      order by r.request_id limit 501`,[trainerId,requestIds])).rows
    if(rows.length&&(rows.length!==requestIds.length||new Set(rows.map(r=>r.request_id)).size!==requestIds.length
      ||new Set(rows.map(r=>r.client_id)).size!==1||rows.some(r=>!r.workout_id||r.created_by!==trainerId
        ||r.status!=='done'||r.deleted_at!==null||r.archived_at!==null||r.merged_into_client_id!==null)))fail('prior_batch_changed')
    return rows
  })
}

function proofEntries({trainerId,payload,scope,readRequest,receipt}) {
  if(!receipt||receipt.trainerId!==trainerId||receipt.programCode!==scope.code||receipt.packetSha256!==scope.sha256
    ||!Array.isArray(receipt.created)||receipt.created.length!==scope.workouts)fail('private_proof_invalid')
  return validateJournalDrafts(payload.workouts,receipt.clientId,readRequest,scope)
}
async function verifyReceipt({owner,runtime,trainerId,payload,scope,readRequest,receipt}) {
  const expected=proofEntries({trainerId,payload,scope,readRequest,receipt})
  const prior=await batchRows(owner,trainerId,expected.map(e=>e.draft.requestId))
  if(!prior.length)return null
  if(prior.some(r=>r.client_id!==receipt.clientId||r.auth_user_id!==receipt.athleteId)
    ||receipt.created.some(c=>!prior.some(r=>r.request_id===c.requestId&&r.workout_id===c.workoutId&&r.workout_date===c.workoutDate)))fail('private_proof_invalid')
  const ids=receipt.created.map(c=>c.workoutId)
  const content=await runtimeRead(runtime,trainerId,async()=>{
    const value=await verifyJournalContent(runtime,{trainerId,clientId:receipt.clientId,entries:expected,created:receipt.created})
    if(receipt.preservedState)await verifyPreservedState(runtime,receipt.clientId,ids,receipt.preservedState)
    if(receipt.createdCard&&!await isNewCardFinanceUnchanged(runtime,{trainerId,clientId:receipt.clientId,entries:expected,created:receipt.created,attendanceVersion:receipt.financeAttendanceVersion===undefined?0:receipt.financeAttendanceVersion}))fail('finance_changed')
    if(receipt.athleteId) {
      await runtime.query("select set_config('request.jwt.claim.sub',$1,true)",[receipt.athleteId])
      if((await runtime.query('select count(*)::int n from public.workouts where id=any($1::uuid[])',[ids])).rows[0]?.n!==scope.workouts)fail('athlete_visibility_changed')
    }
    return value
  })
  await ownerRead(owner,async()=>{
    if(receipt.ownerPreservedState)await verifyPreservedState(owner,receipt.clientId,ids,receipt.ownerPreservedState)
    const pushes=(await owner.query(`select count(*)::int n from app_private.push_notifications_outbox
      where data->>'workout_id'=any($1::text[])`,[ids])).rows[0]?.n
    if(pushes!==0)fail('historical_notification_created')
  })
  return {...content,previousStateVerified:true,athleteLinked:receipt.athleteId!==null}
}

export async function runProgramImport({mode,owner,runtime,target,legacyId=null,parts,approvedSha256,readRequest,
  saveCompleted,createCard,persistReceipt,selectionBinding,beginSingleApply,persistProof,readProof,
  markVerified,preparedReceiptCapability,scopes=reviewedProgramPackets}) {
  if(!['inspect','apply','verify'].includes(mode))fail('mode_invalid')
  const {payload,scope}=readProgramPacket(parts,approvedSha256,readRequest,scopes)
  if(typeof persistReceipt!=='function')fail('receipt_required')
  let trainerId
  try {({trainerId}=await resolveJournalTrainer(owner,target,legacyId))} catch(error) {
    // The old importer deliberately uses one identity error for two causes.
    // Diagnose them through its existing READ ONLY preflight, without choosing
    // a new identity, binding an apply selection or weakening the writer guard.
    if(mode!=='inspect'||error?.message!=='journal_import_current_trainer_identity_required')throw error
    const evidence=await inspectWorkoutHistoryTarget(owner,runtime,target,legacyId)
    if(evidence.trainerMatched&&evidence.yandexIdentityLinked)fail('selection_changed')
    const sources=await inspectIdentitySources(owner,target)
    const result={status:'identity_requires_review',code:scope.code,workouts:0,readOnly:true,
      productionMutated:false,trainerVerified:false,legacyRegistryMatched:legacyId!==null,
      retainedLoginBinding:evidence.retainedLoginBinding===true,
      reason:evidence.trainerMatched?'yandex_identity_missing'
        :sources.retainedProfileCandidates?'additional_binding_requires_review':'email_binding_missing',...sources}
    // The target proof stays only inside the encrypted receipt, never stdout.
    await persistReceipt('readback',{...result,kind:'program_identity_inspection',packetSha256:approvedSha256,
      targetBinding:hash([target.trainerEmailSha256,target.trainerLoginSha256,target.clientNameSha256])})
    return result
  }
  const requestIds=payload.workouts.map(w=>w.requestId)
  if(mode==='verify') {
    if(![readProof,markVerified].every(f=>typeof f==='function'))fail('private_proof_required')
    const proof=await readProof()
    if(!proof) {
      const prior=await batchRows(owner,trainerId,requestIds)
      if(prior.length)fail('private_proof_required')
      await persistReceipt('readback',{kind:'program_write_no_commit',programCode:scope.code,packetSha256:approvedSha256,trainerId,readOnly:true})
      await markVerified('no_commit')
      return {status:'no_commit',code:scope.code,readOnly:true,workouts:0}
    }
    proofEntries({trainerId,payload,scope,readRequest,receipt:proof})
    // Export the authenticated prepared evidence even when later readback finds
    // a changed/deleted record. A failed verify must not hide the closed proof.
    await persistReceipt('prepared',proof)
    if(typeof preparedReceiptCapability==='function')await preparedReceiptCapability()
    const content=await verifyReceipt({owner,runtime,trainerId,payload,scope,readRequest,receipt:proof})
    if(!content) {
      await ownerRead(owner,async()=>{
        if(proof.ownerPreservedState)await verifyPreservedState(owner,proof.clientId,[],proof.ownerPreservedState)
        else if((await owner.query('select id from public.clients where id=$1',[proof.clientId])).rows.length)fail('prior_batch_changed')
      })
    }
    await persistReceipt('readback',{...proof,...content,kind:'program_write_verification',readOnly:true,batchPresent:content!==null})
    await markVerified(content?'complete':'not_present')
    return {status:content?'verified':'not_present',code:scope.code,readOnly:true,workouts:content?scope.workouts:0,...content}
  }
  const prior=await batchRows(owner,trainerId,requestIds)
  if(prior.length)fail('verify_required')
  let inspection
  const summary=await inspectProgramHistory({owner,runtime,target,legacyId,parts,approvedSha256,readRequest,scopes,
    persistInspection:async receipt=>{inspection=receipt}})
  if(!['existing_ready','new_card_ready'].includes(summary.status))fail('source_review_required')
  const selected=inspection.selected
  const baselineOwner=selected?await ownerRead(owner,()=>preservedJournalState(owner,selected.id)):null
  const baselineRuntime=selected?await runtimeRead(runtime,trainerId,()=>preservedJournalState(runtime,selected.id)):null
  const binding=hash({packet:approvedSha256,trainerId,candidates:inspection.candidates,selected,
    baselineOwner,baselineRuntime})
  if(typeof selectionBinding!=='function')fail('selection_required')
  await selectionBinding(mode,binding)
  if(mode==='inspect') {
    await persistReceipt('readback',{...inspection,kind:'program_write_preflight',baselineOwner,baselineRuntime,binding})
    return {...summary,status:'ready',willCreateCard:selected===null,selectionBound:true}
  }
  if(![saveCompleted,createCard,beginSingleApply,persistProof,markVerified].every(f=>typeof f==='function'))fail('writer_guard_required')
  await beginSingleApply()
  const currentSelection=async connection=>{
    const matches=relevant(await readProgramCardCandidates(connection,trainerId,payload))
    if(selected) {
      const exact=matches.filter(c=>c.exact)
      if(exact.length!==1||exact[0].id!==selected.id||exact[0].trainer_id!==selected.trainer_id
        ||exact[0].auth_user_id!==selected.auth_user_id||exact[0].connected!==true
        ||exact[0].archived_at!==null||exact[0].merged_into_client_id!==null)fail('selection_changed')
      return exact[0]
    }
    if(matches.length)fail('selection_changed')
    return null
  }
  let committed
  let commitSeen=false
  try {
    const result=await insertReviewedJournal({runtime,trainerId,clientId:selected?.id??null,athleteId:selected?.auth_user_id??null,
      workouts:payload.workouts,approvedScope:scope,readRequest,saveCompleted,
      checkSelection:async connection=>{
        await currentSelection(connection)
        const candidates=await ownerRead(owner,()=>readProgramCardCandidates(owner,trainerId,payload))
        if(!same(relevant(candidates),inspection.candidates))fail('selection_changed')
        if(selected)await verifyPreservedState(connection,selected.id,[],baselineRuntime)
      },
      existingCard:selected?{partition:selected.trainer_id,resolve:currentSelection,
        readPreserved:async clientId=>{
          const state=await ownerRead(owner,()=>preservedJournalState(owner,clientId))
          if(!same(state,baselineOwner))fail('selection_changed')
          return state
        }}:null,
      newCard:selected?null:{draft:{fullName:payload.clientName,gender:null,ageYears:null,ageUpdatedAt:null,heightCm:null,goal:null,note:null},
        create:createCard,readBatch:async()=>{
          if((await batchRows(owner,trainerId,requestIds)).length)fail('verify_required')
          return null
        }},
      readState:async({clientId})=>ownerRead(owner,async()=>({
        workouts:(await owner.query(`select id,client_id,created_by,status,workout_date::text workout_date,deleted_at,notes
          from public.workouts where client_id=$1 order by id limit 5001`,[clientId])).rows,
        requests:(await owner.query(`select request_id,workout_id from app_private.workout_create_requests
          where actor_id=$1 and request_id=any($2::uuid[]) limit 501`,[trainerId,requestIds])).rows,
      })),
      verifyContent:verifyJournalContent,
      persistReceipt:async(state,receipt)=>{
        const proof={...receipt,programCode:scope.code,packetSha256:approvedSha256}
        if(state==='prepared')await persistProof(proof)
        await persistReceipt(state,proof)
        if(state==='prepared'&&typeof preparedReceiptCapability==='function')await preparedReceiptCapability()
        if(state==='committed'){committed=proof;commitSeen=true}
      },
    })
    if(!committed)fail('outcome_requires_readback')
    const content=await verifyReceipt({owner,runtime,trainerId,payload,scope,readRequest,receipt:committed})
    if(!content)fail('outcome_requires_readback')
    await persistReceipt('readback',{...committed,...content,kind:'program_write_readback'})
    await markVerified('complete')
    return {...result,...content,code:scope.code,createdCard:committed.createdCard}
  } catch(error) {
    if(commitSeen)fail('outcome_requires_readback')
    throw error
  }
}

async function main() {
  const mode=process.env.FIT_JOURNAL_IMPORT_MODE
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='podkolzinpd/fit'
    ||!['inspect','apply','verify'].includes(mode))fail('source_invalid')
  const {readWorkoutHistoryTarget,readHistoryRegistry}=await import('./cloudru-account-history-audit.mjs')
  const target=readWorkoutHistoryTarget(process.env.FIT_WORKOUT_HISTORY_TARGET)
  const upload=await loadCloudruUpload(target,process.env.FIT_JOURNAL_IMPORT_SHA256,process.env.FIT_JOURNAL_UPLOAD_SESSION,{recoveryReadOnly:mode==='verify'})
  const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
  if(process.env.DATABASE_URL||process.env.MIGRATION_DATABASE_URL)fail('database_target_invalid')
  const ownerConfig=buildDatabaseConnectionConfig('MIGRATION_DATABASE'),runtimeConfig=buildDatabaseConnectionConfig('DATABASE')
  for(const [config,user,ssl] of [[ownerConfig,'fit_owner',process.env.MIGRATION_DATABASE_SSL_MODE],[runtimeConfig,'fit_api',process.env.DATABASE_SSL_MODE]]) {
    if(config?.host!=='10.70.10.67'||config.port!==5432||config.database!=='fit'||config.user!==user||ssl!=='require')fail('database_target_invalid')
  }
  const {readSavePlannedWorkoutRequest}=await import('/app/dist/planned-workout-request.js')
  const {saveCompletedWorkout}=await import('/app/dist/workout-commands.js')
  const {createClientCard}=await import('/app/dist/domain-commands.js')
  const {Client}=createRequire('/app/package.json')('pg')
  const owner=new Client({...ownerConfig,connectionTimeoutMillis:5000,query_timeout:15000}),runtime=new Client({...runtimeConfig,connectionTimeoutMillis:5000,query_timeout:20000})
  let interrupted=false;owner.on('error',()=>{interrupted=true});runtime.on('error',()=>{interrupted=true})
  try {
    await owner.connect();await runtime.connect()
    const legacyId=await legacyProfileId(process.env,target,readHistoryRegistry)
    const result=await runProgramImport({mode,owner,runtime,target,legacyId,parts:upload.parts,approvedSha256:process.env.FIT_JOURNAL_IMPORT_SHA256,
      readRequest:readSavePlannedWorkoutRequest,saveCompleted:saveCompletedWorkout,createCard:createClientCard,
      persistReceipt:(state,receipt)=>upload.persistReceipt(state,receipt,sealJournalReceipt),
      selectionBinding:upload.selectionBinding,beginSingleApply:upload.beginSingleProgramApply,persistProof:upload.persistProgramProof,
      readProof:upload.readProgramProof,markVerified:upload.markProgramVerified,preparedReceiptCapability:upload.preparedReceiptCapability})
    if(interrupted)fail('outcome_requires_readback')
    console.log(JSON.stringify({event:'program_history_write',...result}))
  }finally{await Promise.allSettled([owner.end(),runtime.end()]);upload.close()}
}
const safeCodes=new Set(['mode_invalid','source_invalid','database_target_invalid','receipt_required','private_proof_required',
  'identity_sources_scope_exceeded',
  'private_proof_invalid','prior_batch_changed','verify_required','source_review_required','selection_required','selection_changed',
  'writer_guard_required','finance_changed','athlete_visibility_changed','historical_notification_created','outcome_requires_readback',
  'packet_invalid','runtime_role_invalid','readonly_required','trainer_ambiguous','current_trainer_identity_required','trainer_role_invalid',
  'target_invalid','scope_invalid','draft_invalid','request_invalid','dates_invalid','state_invalid','receipt_invalid','partial_prior_batch',
  'previous_state_changed','unexpected_finance_change','save_postcondition_failed','failed_rolled_back','content_readback_failed','busy',
  'legacy_registry_unavailable','legacy_registry_config_missing','legacy_registry_credential_missing'])
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  const message=error instanceof Error?error.message:''
  const prefix=['program_history_write_','program_history_inspect_','journal_import_'].find(value=>message.startsWith(value))
  const code=prefix?message.slice(prefix.length):''
  console.error(JSON.stringify({event:'program_history_write_failed',code:safeCodes.has(code)?code:'failed',...safeJournalUploadFailure(error)}));process.exitCode=1
})
