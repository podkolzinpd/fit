import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,generateKeyPairSync} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {assertOutsideActions,directObject,validateDirectRequest,bindDirectState,completeDirectState,
  acknowledgeDirect,sealDirectRequest,openDirectRequest,validateDirectCapability} from './cloudru-program-direct-protocol.mjs'
import {executeDirectEntry} from './cloudru-program-direct-entry.mjs'
import {directContainerArguments} from './cloudru-program-direct-worker.mjs'
import {reviewedProgramPackets} from './private-program-history-scopes.mjs'

const hash=v=>createHash('sha256').update(v).digest('hex')
const main='a'.repeat(40)
const target={trainerEmailSha256:hash('fixture@example.test'),trainerLoginSha256:hash('fixture'),clientNameSha256:hash('fixture client')}
const evidence={version:1,targetBinding:hash(JSON.stringify([target.trainerEmailSha256,target.trainerLoginSha256,target.clientNameSha256])),
  rosterNameHashes:Array.from({length:17},(_,i)=>hash('fixture name '+i))}
const request=(stage='transfer',mode='prepare',code='F01',session='123-1')=>({version:1,main,stage,mode,code,session,attempt:'456-1',
  digest:reviewedProgramPackets.find(p=>p.code===code).sha256,target,trainerEvidence:evidence})
const pair=()=>generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const server=pair(),operator=pair()

test('direct channel authenticates operator signature, encrypted session and monotonic sequence',()=>{
  const value={session:'100-1',sequence:1,main,kind:'journal',request:request()}
  const box=sealDirectRequest(value,server.publicKey,operator.privateKey,'100-1')
  assert.deepEqual(openDirectRequest(box,server.privateKey,operator.publicKey,'100-1',1),value)
  assert.doesNotMatch(JSON.stringify(box),/fixture|trainerEmailSha256|rosterNameHashes/)
  assert.throws(()=>openDirectRequest(box,server.privateKey,operator.publicKey,'100-1',2))
  assert.throws(()=>openDirectRequest(box,server.privateKey,operator.publicKey,'101-1',1))
  const changed=structuredClone(box);changed.envelope.data=changed.envelope.data.replace(/^./,changed.envelope.data[0]==='A'?'B':'A')
  assert.throws(()=>openDirectRequest(changed,server.privateKey,operator.publicKey,'100-1',1))
  assert.throws(()=>openDirectRequest({...box,signature:box.signature.slice(4)},server.privateKey,operator.publicKey,'100-1',1))
})
test('all direct operations reject Actions environments before reading or dispatching client data',async()=>{
  assert.doesNotThrow(()=>assertOutsideActions({PATH:'/usr/bin'}))
  for(const name of ['GITHUB_ACTIONS','GITHUB_REF','RUNNER_TEMP','ACTIONS_RUNTIME_TOKEN','CI']) {
    assert.throws(()=>assertOutsideActions({[name]:''}))
    let called=false
    await assert.rejects(executeDirectEntry(request(),{main,env:{[name]:'false'},prepare:async()=>{called=true}}))
    assert.equal(called,false)
  }
})
test('bounded private input cannot introduce a free actor, SQL, unapproved packet or alternate target',()=>{
  assert.deepEqual(validateDirectRequest(request(),main),request())
  for(const extra of [{actorId:'fixture'},{sql:'select 1'},{path:'/tmp/other'},{operatorPublicPem:'override'}])
    assert.throws(()=>validateDirectRequest({...request(),...extra},main))
  for(const bad of [{main:'b'.repeat(40)},{digest:'b'.repeat(64)},{stage:'arbitrary'},
    {session:'../../other'},{stage:'review',mode:'apply'},{stage:'recovery',code:'F02',mode:'verify'},
    {trainerEvidence:{...evidence,targetBinding:hash('other')}}])
    assert.throws(()=>validateDirectRequest({...request(),...bad},main))
})
test('original recovery, sequential journals and an independent verified acknowledgement gate cleanup',()=>{
  const state={}
  assert.throws(()=>bindDirectState(state,request()))
  const recover=request('recovery','verify')
  bindDirectState(state,recover);completeDirectState(state,recover,{status:'no_commit'})
  const retired={...recover,mode:'cleanup'}
  bindDirectState(state,retired);completeDirectState(state,retired,{})
  assert.equal(state.recovered,true)
  assert.throws(()=>bindDirectState(state,request('review','prepare','F02','222-1')))
  for(const stage of ['review','transfer']) {
    const r=request(stage,'prepare','F01',stage==='review'?'333-1':'444-1')
    bindDirectState(state,r);completeDirectState(state,r,{})
    const inspect={...r,mode:'inspect'};bindDirectState(state,inspect);completeDirectState(state,inspect,{status:stage==='review'?'existing_ready':'ready'})
  }
  const apply=request('transfer','apply','F01','444-1')
  bindDirectState(state,apply)
  assert.throws(()=>bindDirectState(state,apply))
  assert.throws(()=>bindDirectState(state,{...apply,mode:'cleanup'}))
  const verified={...apply,mode:'verify'}
  bindDirectState(state,verified);completeDirectState(state,verified,{status:'verified'})
  assert.throws(()=>acknowledgeDirect(state,'F01','wrong-session'))
  assert.throws(()=>bindDirectState(state,{...apply,mode:'cleanup'}))
  acknowledgeDirect(state,'F01','444-1')
  for(const [stage,session] of [['transfer','444-1'],['review','333-1']]) {
    const cleanup=request(stage,'cleanup','F01',session);bindDirectState(state,cleanup);completeDirectState(state,cleanup,{})
  }
  assert.doesNotThrow(()=>bindDirectState(state,request('review','prepare','F02','222-1')))
  assert.throws(()=>bindDirectState(state,{...request('review','prepare','F02','222-1'),target:{...target,clientNameSha256:hash('other')}}))
})
test('uncertain apply never allows another writer operation before verify',()=>{
  const state={recovered:true,codes:{F01:{review:{session:'111-1',prepared:true,inspected:true},transfer:{session:'123-1',prepared:true,inspected:true}}}}
  bindDirectState(state,request('transfer','apply'))
  const restored=JSON.parse(JSON.stringify(state))
  for(const mode of ['apply','prepare','inspect','cleanup'])assert.throws(()=>bindDirectState(restored,request('transfer',mode)))
  assert.doesNotThrow(()=>bindDirectState(restored,request('transfer','verify')))
  assert.throws(()=>completeDirectState(restored,request('transfer','verify'),{status:'no_commit'}))
})
test('direct entry reuses normal encrypted prepare/load/cleanup and core writer without GitHub impersonation',async()=>{
  const calls=[],env={}
  const deps={main,env,operatorPublicPem:operator.publicKey,
    prepare:async(...args)=>{calls.push(['prepare',args]);return {status:'upload_prepared'}},
    cleanup:async(...args)=>{calls.push(['cleanup',args]);return {status:'cleaned'}},
    load:async(...args)=>{calls.push(['load',args]);return {parts:[]}},
    write:async args=>{calls.push(['write',args]);return {status:'verified'}},
    inspect:async args=>{calls.push(['inspect',args]);return {status:'existing_ready'}}}
  assert.equal((await executeDirectEntry(request(),deps)).status,'upload_prepared')
  assert.equal((await executeDirectEntry(request('recovery','verify'),deps)).status,'verified')
  assert.deepEqual(calls.find(c=>c[0]==='load')[1][3],{recoveryReadOnly:true})
  await executeDirectEntry(request('review','inspect'),deps)
  await executeDirectEntry(request('review','cleanup'),deps)
  assert.ok(calls.some(c=>c[0]==='inspect'));assert.ok(calls.some(c=>c[0]==='cleanup'))
  assert.equal(env.GITHUB_REF,undefined)
})
test('per-operation containers are bounded, isolated, mounted to one session and receive private input only through stdin',()=>{
  const args=directContainerArguments({root:'/opt/fit/secrets/program-direct-999-1',main,session:'123-1',sequence:1})
  assert.ok(args.includes('--read-only'));assert.ok(args.includes('--cap-drop=ALL'))
  assert.ok(args.includes('/opt/fit/secrets/journal-upload-123-1:/session:rw'))
  assert.equal(args.at(-1),'/journal/cloudru-program-direct-entry.mjs')
  assert.doesNotMatch(args.join(' '),/GITHUB|trainerEmail|rosterName|--privileged|podman.sock|:5432/)
  assert.throws(()=>directContainerArguments({root:'/tmp/untrusted',main,session:'123-1',sequence:1}))
})
test('control capabilities reject foreign endpoints, alternate objects and excessive expiry',()=>{
  const now=Date.now(),session='100-1',sequence=1
  const url=kind=>`https://s3.cloud.ru/fit-cloudru-stage-media-c2ad3760/${directObject(session,sequence,kind)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=7200&X-Amz-Signature=${'a'.repeat(64)}`
  const cap={main,session,sequence,expiresAt:now+7200000,put:url('request'),get:url('response')}
  assert.equal(validateDirectCapability(cap,session,sequence,main,now),cap)
  for(const changed of [{get:url('request')},{put:url('request').replace('s3.cloud.ru','example.test')},{expiresAt:now-1},
    {put:url('request').replace('Expires=7200','Expires=9999')},{main:'b'.repeat(40)}])
    assert.throws(()=>validateDirectCapability({...cap,...changed},session,sequence,main,now))
})
test('installer has no customer inputs, secrets, result uploads or data-processing command',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/start-cloudru-private-program-service.yml',import.meta.url),'utf8')
  assert.match(workflow,/group: cloudru-stage-vm/)
  assert.match(workflow,/EnvironmentFile=\$root\/service.env/)
  assert.match(workflow,/StandardOutput=null.*StandardError=null/)
  assert.doesNotMatch(workflow,/FIT_ATHLETE|FIT_PROGRAM_TRAINER|FIT_WORKOUT_HISTORY_TARGET|approved_sha256|rosterNameHashes|trainerEmailSha256|STEP_SUMMARY/)
  assert.equal((workflow.match(/uses: actions\/upload-artifact/g)??[]).length,1)
  assert.ok(workflow.indexOf('uses: actions/upload-artifact')<workflow.indexOf('Reserve VM serialization'))
  assert.doesNotMatch(workflow,/node.*cloudru-program-history-(?:write|inspect)/)
})
