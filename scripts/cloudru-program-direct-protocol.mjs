import {constants,createHash,sign,verify} from 'node:crypto'
import {sealUpload,openUpload,journalSession} from './cloudru-journal-upload.mjs'
import {readWorkoutHistoryTarget} from './cloudru-account-history-audit.mjs'
import {readProgramTrainerEvidence} from './cloudru-program-trainer-evidence.mjs'
import {reviewedProgramPackets} from './private-program-history-scopes.mjs'

const fail=()=>{throw Error('program_direct_rejected')}
const keys=(v,want)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===want.split(',').sort().join(',')
export const directBucket='fit-cloudru-stage-media-c2ad3760'
export const directTenant='f071c7d5-cf0f-4538-9415-bbf9a9c94338'
export const directMaxBytes=65536
export function directObject(session,sequence,kind) {
  journalSession(session)
  if(!Number.isInteger(sequence)||sequence<1||sequence>400||!['request','response'].includes(kind))fail()
  return `operations/private-program-direct/${session}/${kind}-${String(sequence).padStart(4,'0')}.encrypted.json`
}
export function assertOutsideActions(env=process.env) {
  if(Object.keys(env).some(k=>/^(?:GITHUB_|ACTIONS_|RUNNER_)/u.test(k))||env.CI!==undefined)fail()
}
export function validateDirectRequest(value,main,scopes=reviewedProgramPackets) {
  if(!keys(value,'version,main,stage,mode,code,digest,session,attempt,target,trainerEvidence')||value.version!==1||value.main!==main
    ||!['review','transfer','recovery'].includes(value.stage)||!['prepare','inspect','apply','verify','cleanup'].includes(value.mode))fail()
  const scope=scopes.find(s=>s.code===value.code&&s.sha256===value.digest)
  if(!scope||!/^[a-f0-9]{40}$/u.test(main))fail()
  journalSession(value.session);journalSession(value.attempt)
  if(value.stage==='review'&&!['prepare','inspect','cleanup'].includes(value.mode)
    ||value.stage==='recovery'&&(value.code!=='F01'||!['verify','cleanup'].includes(value.mode)))fail()
  const target=readWorkoutHistoryTarget(JSON.stringify(value.target))
  const trainerEvidence=readProgramTrainerEvidence(JSON.stringify(value.trainerEvidence),target)
  if(!trainerEvidence)fail()
  return {...value,target,trainerEvidence}
}
export function bindDirectState(state,request) {
  // The original target and separate evidence are immutable for the whole lease.
  const binding=createHash('sha256').update(JSON.stringify([request.target,request.trainerEvidence])).digest('hex')
  if(state.binding&&state.binding!==binding)fail()
  state.binding=binding
  state.codes??={}
  const person=state.codes[request.code]??={}
  const index=Number(request.code.slice(1))
  if(request.stage!=='recovery') {
    if(state.recovered!==true)fail()
    for(let n=1;n<index;n++) {
      const prior=state.codes[`F${String(n).padStart(2,'0')}`]
      if(!prior?.review?.cleaned||!prior?.transfer?.cleaned||!prior?.transfer?.acknowledged)fail()
    }
  }
  const record=person[request.stage]??={session:request.session}
  if(record.session!==request.session||record.cleaned)fail()
  if(request.stage==='recovery'&&state.recovered||request.mode==='prepare'&&record.prepared)fail()
  if(request.stage!=='recovery'&&request.mode!=='prepare'&&!record.prepared)fail()
  if(request.mode==='apply') {
    if(request.stage!=='transfer'||!record.inspected||record.applyStarted||!person.review?.inspected)fail()
    record.applyStarted=true // durable before execution; never blindly repeat apply
  }
  if(record.applyStarted&&!record.verified&&!['apply','verify'].includes(request.mode))fail()
  if(request.mode==='cleanup') {
    if(request.stage==='transfer'&&(!record.verified||!record.acknowledged)
      ||request.stage==='review'&&!person.transfer?.acknowledged
      ||request.stage==='recovery'&&!record.verified)fail()
  }
  return record
}
export function completeDirectState(state,request,result) {
  const record=state.codes[request.code][request.stage]
  if(request.mode==='prepare')record.prepared=true
  if(request.mode==='inspect') {
    if(!['existing_ready','ready'].includes(result?.status)||result.willCreateCard===true)fail()
    record.inspected=true
  }
  if(request.mode==='verify') {
    if(request.stage==='recovery'?result?.status!=='no_commit':result?.status!=='verified')fail()
    record.verified=true
  }
  if(request.mode==='cleanup') {
    record.cleaned=true
    if(request.stage==='recovery')state.recovered=true
  }
}
export function acknowledgeDirect(state,code,session) {
  const record=state.codes?.[code]?.transfer
  if(!record||record.session!==session||!record.verified||record.cleaned)fail()
  record.acknowledged=true
}
export function sealDirectRequest(value,serverPublic,operatorPrivate,session) {
  const envelope=sealUpload(value,serverPublic,session)
  const bytes=Buffer.from(JSON.stringify(envelope))
  const signature=sign('sha256',bytes,{key:operatorPrivate,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')
  return {envelope,signature}
}
export function openDirectRequest(box,serverPrivate,operatorPublic,session,sequence) {
  if(!keys(box,'envelope,signature')||typeof box.signature!=='string'||box.signature.length>2048
    ||!verify('sha256',Buffer.from(JSON.stringify(box.envelope)),{key:operatorPublic,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(box.signature,'base64')))fail()
  const value=openUpload(box.envelope,serverPrivate,session)
  if(!value||value.session!==session||value.sequence!==sequence)fail()
  return value
}
export function validateDirectCapability(value,session,sequence,main,now=Date.now()) {
  if(!value||value.session!==session||value.sequence!==sequence||value.main!==main||!Number.isSafeInteger(value.expiresAt)
    ||value.expiresAt<=now||value.expiresAt>now+2*60*60*1000+10000)fail()
  for(const [name,kind] of [['put','request'],['get','response']]) {
    const u=new URL(value[name])
    if(u.protocol!=='https:'||u.hostname!=='s3.cloud.ru'||u.port||u.username||u.password||u.hash
      ||decodeURIComponent(u.pathname)!==`/${directBucket}/${directObject(session,sequence,kind)}`
      ||u.searchParams.get('X-Amz-Algorithm')!=='AWS4-HMAC-SHA256'
      ||!/^[a-f0-9]{64}$/u.test(u.searchParams.get('X-Amz-Signature')??'')
      ||!/^\d{1,4}$/u.test(u.searchParams.get('X-Amz-Expires')??'')||Number(u.searchParams.get('X-Amz-Expires'))>7200)fail()
  }
  return value
}
