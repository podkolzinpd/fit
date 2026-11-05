import {createRequire} from 'node:module'
import {generateKeyPairSync} from 'node:crypto'
import {lstatSync,readFileSync,writeFileSync,openSync,fsyncSync,closeSync,renameSync,mkdirSync,existsSync,rmdirSync,unlinkSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {hostname} from 'node:os'
import {pathToFileURL} from 'node:url'
import {sealUpload,journalSession} from './cloudru-journal-upload.mjs'
import {assertOutsideActions,directBucket,directTenant,directMaxBytes,directObject,openDirectRequest,
  validateDirectRequest,bindDirectState,completeDirectState,acknowledgeDirect} from './cloudru-program-direct-protocol.mjs'

const fail=()=>{throw Error('program_direct_rejected')}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let draining=false
function directory(path) {
  const s=lstatSync(path)
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==0o700)fail()
}
function privateRead(path,max=directMaxBytes) {
  const s=lstatSync(path)
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==0o600||s.size>max)fail()
  return readFileSync(path,'utf8')
}
function durable(path,value) {
  const tmp=path+'.pending'
  const fd=openSync(tmp,'wx',0o600)
  try{writeFileSync(fd,value);fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(tmp,path)
  const parent=openSync(path.slice(0,path.lastIndexOf('/')),'r')
  try{fsyncSync(parent)}finally{closeSync(parent)}
}
function context() {
  assertOutsideActions()
  const env=process.env,session=journalSession(env.FIT_DIRECT_SESSION),main=env.FIT_DIRECT_MAIN
  const root=`/opt/fit/secrets/program-direct-${session}`
  if(process.getuid()!==0||hostname()!=='fit-stage-app'||!/^[a-f0-9]{40}$/u.test(main??'')||env.FIT_DIRECT_ROOT!==root)fail()
  directory('/opt/fit/secrets');directory(root)
  const operatorPublic=privateRead(root+'/operator.public.pem',8192)
  const require=createRequire(root+'/runtime/package.json')
  const sdk=require('@aws-sdk/client-s3'),{getSignedUrl}=require('@aws-sdk/s3-request-presigner')
  const keyId=env.CLOUDRU_MEDIA_KEY_ID,secretAccessKey=env.CLOUDRU_MEDIA_KEY_SECRET
  if(!keyId||!secretAccessKey||keyId.includes(':')||/[\r\n]/u.test(keyId+secretAccessKey))fail()
  const client=new sdk.S3Client({endpoint:'https://s3.cloud.ru',forcePathStyle:true,region:'ru-central-1',maxAttempts:2,
    requestChecksumCalculation:'WHEN_REQUIRED',requestHandler:{connectionTimeout:5000,requestTimeout:15000},
    credentials:{accessKeyId:`${directTenant}:${keyId}`,secretAccessKey}})
  return {root,session,main,operatorPublic,sdk,client,getSignedUrl}
}
async function capability(c,sequence,publicKey,expiresAt) {
  const expiresIn=Math.max(1,Math.floor((expiresAt-Date.now())/1000))
  if(expiresIn>7200||expiresIn<1)fail()
  const put=await c.getSignedUrl(c.client,new c.sdk.PutObjectCommand({Bucket:directBucket,Key:directObject(c.session,sequence,'request'),
    ContentType:'application/octet-stream',IfNoneMatch:'*'}),{expiresIn})
  const get=await c.getSignedUrl(c.client,new c.sdk.GetObjectCommand({Bucket:directBucket,Key:directObject(c.session,sequence,'response')}),{expiresIn})
  return {version:1,session:c.session,main:c.main,sequence,publicKey,expiresAt,put,get}
}
async function getRequest(c,sequence) {
  let result
  try{result=await c.client.send(new c.sdk.GetObjectCommand({Bucket:directBucket,Key:directObject(c.session,sequence,'request')}))}
  catch(e){if(e?.$metadata?.httpStatusCode===404)return null;throw e}
  if(!Number.isSafeInteger(result.ContentLength)||result.ContentLength<1||result.ContentLength>directMaxBytes)fail()
  const chunks=[];let bytes=0
  for await(const chunk of result.Body){bytes+=chunk.length;if(bytes>directMaxBytes)fail();chunks.push(chunk)}
  if(bytes!==result.ContentLength)fail()
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
async function podman(args,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/podman',args,{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']})
    const chunks=[];let size=0
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>directMaxBytes)child.kill('SIGTERM');else chunks.push(chunk)})
    child.stderr.on('data',()=>{}) // database/server diagnostics never enter Actions or replies
    child.on('error',reject)
    child.on('close',code=>{if(code!==0||size>directMaxBytes)reject(Error('program_direct_operation_failed'))
      else {try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('program_direct_operation_failed'))}}})
    child.stdin.on('error',()=>{})
    child.stdin.end(input)
  })
}
export function directContainerArguments({root,main,session,sequence}) {
  journalSession(session)
  if(!/^\/opt\/fit\/secrets\/program-direct-\d{1,20}-\d{1,4}$/u.test(root)||!/^[a-f0-9]{40}$/u.test(main)
    ||!Number.isInteger(sequence)||sequence<1||sequence>400)fail()
  return ['run','--rm','--read-only','--user','0','--memory=384m','--cpus=1','--timeout=180',
    '--cap-drop=ALL','--security-opt=no-new-privileges','--env-file',root+'/operation.env',
    '-v',root+'/code/scripts:/journal:ro','-v',`/opt/fit/secrets/journal-upload-${session}:/session:rw`,
    '-v',root+`/capabilities/${sequence}:/capability:rw`,'-v',root+'/operator.public.pem:/direct/operator.public.pem:ro',
    `localhost/fit-api:${main}`,'node','/journal/cloudru-program-direct-entry.mjs']
}
async function operation(c,request,sequence) {
  if(readFileSync('/opt/fit/RUNNING_SHA','utf8').trim()!==c.main)fail()
  const path=`/opt/fit/secrets/journal-upload-${request.session}`
  if(request.mode==='prepare') {
    if(existsSync(path))fail()
    mkdirSync(path,{mode:0o700})
  }
  directory(path)
  if(request.stage==='recovery'&&existsSync(path+'/program-apply.started.json'))fail()
  const cap=c.root+`/capabilities/${sequence}`
  mkdirSync(cap,{mode:0o700})
  const names=['CLOUDRU_MEDIA_KEY_ID','CLOUDRU_MEDIA_KEY_SECRET','SUPABASE_PROJECT_ID','SUPABASE_ACCESS_TOKEN',
    ...['DATABASE','MIGRATION_DATABASE'].flatMap(prefix=>['HOST','PORT','NAME','USER','PASSWORD'].map(k=>prefix+'_'+k))]
  const env=names.map(name=>{
    const value=process.env[name]
    if(!value||/[\r\n\0]/u.test(value))fail()
    return name+'='+value
  })
  env.push('DATABASE_SSL_MODE=require','MIGRATION_DATABASE_SSL_MODE=require','FIT_DIRECT_MAIN='+c.main)
  durable(c.root+'/operation.env',env.join('\n')+'\n')
  try {
    const result=await podman(directContainerArguments({root:c.root,main:c.main,session:request.session,sequence}),JSON.stringify(request))
    const capabilities={}
    for(const name of ['capability.encrypted.json','prepared-capability.encrypted.json']) {
      if(existsSync(cap+'/'+name)) {
        const s=lstatSync(cap+'/'+name)
        if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.size>directMaxBytes)fail()
        capabilities[name]=JSON.parse(readFileSync(cap+'/'+name,'utf8'))
      }
    }
    if(request.mode==='cleanup')rmdirSync(path)
    return {result,capabilities}
  } finally {unlinkSync(c.root+'/operation.env')}
}
async function bootstrap(c) {
  if(existsSync(c.root+'/state.json')||existsSync(c.root+'/server.private.pem'))fail()
  const pair=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const expiresAt=Date.now()+2*60*60*1000
  durable(c.root+'/server.private.pem',pair.privateKey)
  durable(c.root+'/state.json',JSON.stringify({version:1,sequence:1,expiresAt,publicKey:pair.publicKey,codes:{}}))
  const cap=await capability(c,1,pair.publicKey,expiresAt)
  // Created before any customer input. Only encryption/capability infrastructure
  // is returned to the installer; no target, packet digest, roster or result.
  const envelope=sealUpload(cap,c.operatorPublic,c.session)
  writeFileSync(c.root+'/bootstrap/capability.encrypted.json',JSON.stringify(envelope),{mode:0o644,flag:'wx'})
}
async function run(c) {
  process.on('SIGTERM',()=>{draining=true})
  process.on('SIGINT',()=>{draining=true})
  const state=JSON.parse(privateRead(c.root+'/state.json'))
  const key=privateRead(c.root+'/server.private.pem',8192)
  let failures=0
  while(!draining&&Date.now()<state.expiresAt&&state.sequence<=399) {
    let box
    try{box=await getRequest(c,state.sequence);failures=0}catch{if(++failures>=3)fail();await pause(2000);continue}
    if(box===null){await pause(1500);continue}
    const value=openDirectRequest(box,key,c.operatorPublic,c.session,state.sequence)
    if(value.main!==c.main)fail()
    let response={ok:false},finish=false
    try {
      if(value.kind==='journal') {
        const request=validateDirectRequest(value.request,c.main)
        // Persist before executing. Restarted/uncertain apply is never replayed.
        if(state.pending) {
          if(state.pending.sequence!==state.sequence)fail()
          response={ok:false,error:'outcome_requires_verify'}
        } else {
          bindDirectState(state,request)
          state.pending={sequence:state.sequence,stage:request.stage,code:request.code,mode:request.mode}
          durable(c.root+'/state.json',JSON.stringify(state))
          response={ok:true,...await operation(c,request,state.sequence)}
          completeDirectState(state,request,response.result)
        }
      } else if(value.kind==='acknowledge') {
        acknowledgeDirect(state,value.code,value.journalSession)
        response={ok:true}
      } else if(value.kind==='finish') {
        if(!state.recovered||Object.keys(state.codes).length!==17||Object.values(state.codes).some(p=>!p.review?.cleaned||!p.transfer?.cleaned||!p.transfer?.acknowledged))fail()
        response={ok:true};finish=true
      } else fail()
    }catch{response={ok:false,error:'operation_requires_review'}}
    const sequence=state.sequence
    const next=finish?null:await capability(c,sequence+1,state.publicKey,state.expiresAt)
    const reply=sealUpload({version:1,session:c.session,sequence,main:c.main,...response,next},c.operatorPublic,c.session)
    // Save the closed reply before advancing; a lost HTTP result is read back.
    durable(c.root+`/responses/${sequence}.encrypted.json`,JSON.stringify(reply))
    await c.client.send(new c.sdk.PutObjectCommand({Bucket:directBucket,Key:directObject(c.session,sequence,'response'),Body:JSON.stringify(reply),ContentType:'application/octet-stream'}))
    state.sequence++;delete state.pending
    durable(c.root+'/state.json',JSON.stringify(state))
    if(finish) {
      // All journal keys are already retired by their normal guarded cleanup.
      // Crypto-erasure of this control key makes retained request ciphertext inert.
      unlinkSync(c.root+'/server.private.pem')
      return
    }
  }
  throw Error('program_direct_expired_or_draining')
}
async function main() {
  const c=context()
  try {
    if(process.argv[2]==='bootstrap')await bootstrap(c)
    else if(process.argv[2]==='run')await run(c)
    else fail()
  }finally{c.client.destroy()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  // The system service log has no per-client parameters or server diagnostics.
  process.stderr.write('{"event":"direct_service_requires_review"}\n');process.exitCode=1
})
