import {createHash,sign,verify,constants} from 'node:crypto'
import {createRequire} from 'node:module'
import {writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {prepareCloudruUpload,loadCloudruUpload,cleanupCloudruUpload,cleanupUnreceivedCloudruUpload,sealUpload,journalSession,journalObject,validateUploadCapability,safeJournalUploadFailure} from './cloudru-journal-upload.mjs'
import {readRestoreTarget,readExpectedRestoreHistory,planClientRestore} from './cloudru-client-restore.mjs'

// Public protocol identifiers; these are NEVER derived from a customer.
export const clientRestoreInputDigest=createHash('sha256').update('fit-private-client-restore-input-v1').digest('hex')
const target={trainerLoginSha256:clientRestoreInputDigest,trainerEmailSha256:clientRestoreInputDigest,clientNameSha256:clientRestoreInputDigest}
const need=(ok,code)=>{if(!ok)throw Error('client_restore_'+code)}
export function validatePrivateRestoreCapability(cap,session,now=Date.now()){
 validateUploadCapability(cap,session,clientRestoreInputDigest,now)
 const url=new URL(cap.readbackUrl)
 need(url.protocol==='https:'&&url.hostname==='s3.cloud.ru'&&!url.port&&!url.username&&!url.password&&!url.hash
   &&decodeURIComponent(url.pathname)==='/fit-cloudru-stage-media-c2ad3760/'+journalObject(session,'readback')
   &&url.searchParams.get('X-Amz-Expires')==='600'&&url.searchParams.get('X-Amz-Algorithm')==='AWS4-HMAC-SHA256'
   &&url.searchParams.get('X-Amz-SignedHeaders')==='host'&&/^[a-f0-9]{64}$/u.test(url.searchParams.get('X-Amz-Signature')??''),'private_reply_capability')
 return cap
}
const signingBody=(session,pair,expected)=>JSON.stringify(['fit-private-client-restore-input-v1',session,pair.trainerId,pair.athleteId,
 expected.clientId,expected.workoutIds,expected.workouts,expected.exercises,expected.sets])
export function privateRestoreInputParts(value,session,operatorPrivatePem){
 journalSession(session)
 const pair=readRestoreTarget(JSON.stringify(value.target)),expected=readExpectedRestoreHistory(value.expectedHistory)
 const signature=sign('sha256',Buffer.from(signingBody(session,pair,expected)),{key:operatorPrivatePem,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')
 const encoded=Buffer.from(JSON.stringify({version:1,session,target:value.target,expectedHistory:expected,signature})).toString('base64')
 const at=Math.ceil(encoded.length/2);return [encoded.slice(0,at),encoded.slice(at)]
}
export function readPrivateRestoreInput(parts,session,operatorPublicPem){
 need(Array.isArray(parts)&&parts.length===2&&parts.every(x=>typeof x==='string'&&x.length>0&&x.length<=64000),'private_input')
 const encoded=parts.join(''),bytes=Buffer.from(encoded,'base64')
 need(bytes.toString('base64')===encoded&&bytes.length<=64000,'private_input')
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw Error('client_restore_private_input')}
 need(value&&Object.keys(value).sort().join(',')==='expectedHistory,session,signature,target,version'&&value.version===1
   &&value.session===journalSession(session),'private_input')
 const pair=readRestoreTarget(JSON.stringify(value.target)),expectedHistory=readExpectedRestoreHistory(value.expectedHistory)
 need(typeof value.signature==='string'&&value.signature.length<=1500&&/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signature),'private_signature')
 need(verify('sha256',Buffer.from(signingBody(session,pair,expectedHistory)),
   {key:operatorPublicPem,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(value.signature,'base64')),'private_signature')
 return {pair,expectedHistory}
}
export async function executePrivateRestoreInput({phase,session,operatorPublicPem,store,createOwner,savePlan,operator}){
 journalSession(session)
 need(['prepare','cleanup-prepare','plan'].includes(phase),'private_phase')
 if(phase==='cleanup-prepare')return store.cleanupUnreceived(target,clientRestoreInputDigest,session,operatorPublicPem)
 if(phase==='prepare'){
  await store.prepare(target,clientRestoreInputDigest,session,operatorPublicPem,{prepareReadback:true})
  return {event:'client_restore_private_input_prepared',customerInputReceived:false}
 }
 let io,owner,closed=false,result
 try{
  io=await store.load(target,clientRestoreInputDigest,session)
  const input=readPrivateRestoreInput(io.parts,session,io.publicPem)
  owner=await createOwner()
  const plan=await planClientRestore(owner,input.pair,input.expectedHistory)
  plan.requestedBy=operator;plan.privateInputSession=session
  await savePlan(plan)
  await io.persistReceipt('readback',{kind:'client_restore_private_plan',session,digest:clientRestoreInputDigest,plan},(value,key)=>sealUpload(value,key,session))
  closed=true;result={event:'client_restore_private_plan_ready',readOnly:true,privateInput:true}
 }catch(error){
  if(io){
   const code=/^client_restore_[a-z_]+$/u.test(error?.message??'')?error.message:'client_restore_private_plan_failed'
   await io.persistReceipt('readback',{kind:'client_restore_private_plan_rejected',session,digest:clientRestoreInputDigest,code,
    ...(error?.privateDiagnostic?{privateDiagnostic:error.privateDiagnostic}:{})},(value,key)=>sealUpload(value,key,session))
   closed=true
  }
  throw error
 }finally{
  if(owner)await owner.end()
  if(io)io.close()
  if(closed)await store.cleanup(target,clientRestoreInputDigest,session)
 }
 return result
}
async function main(){
 need(process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_REPOSITORY==='podkolzinpd/fit','private_environment')
 const phase=process.env.RESTORE_PHASE,session=journalSession(process.env.RESTORE_PREPARE_SESSION)
 const result=await executePrivateRestoreInput({phase,session,operator:process.env.GITHUB_ACTOR,
  operatorPublicPem:Buffer.from(process.env.RESTORE_OPERATOR_PUBLIC_KEY_B64??'','base64').toString('utf8'),
  store:{prepare:prepareCloudruUpload,load:loadCloudruUpload,cleanup:cleanupCloudruUpload,cleanupUnreceived:cleanupUnreceivedCloudruUpload},
  createOwner:async()=>{
   const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
   const config=buildDatabaseConnectionConfig('MIGRATION_DATABASE')
   need(config.host==='10.70.10.67'&&config.port===5432&&config.database==='fit'&&config.user==='fit_owner'
     &&process.env.MIGRATION_DATABASE_SSL_MODE==='require','private_environment')
   const {Client}=createRequire('/app/package.json')('pg');const client=new Client({...config,connectionTimeoutMillis:5000,query_timeout:15000})
   await client.connect();return client
  },savePlan:async plan=>writeFileSync('/repair/plan.json',JSON.stringify(plan),{mode:0o600,flag:'wx'})})
 console.log(JSON.stringify(result))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 if(/^client_restore_[a-z_]+$/u.test(error?.message??''))console.error(error.message)
 else console.error(JSON.stringify({event:'client_restore_private_failed',...safeJournalUploadFailure(error)}))
 process.exitCode=1
})
