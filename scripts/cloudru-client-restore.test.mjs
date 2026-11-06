import {test} from 'node:test'
import {generateKeyPairSync} from 'node:crypto'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {readRestoreTarget,planClientRestore,applyClientRestore,verifyClientRestore,privateRestoreTechnicalResult} from './cloudru-client-restore.mjs'
import {readPrivateRestoreInput,executePrivateRestoreInput,clientRestoreInputDigest,validatePrivateRestoreCapability,privateRestoreInputParts} from './cloudru-client-restore-private.mjs'

test('only an explicit privately approved native profile pair is accepted',()=>{
 const target={trainerProfileId:'11111111-1111-4111-8111-111111111111',athleteProfileId:'22222222-2222-4222-8222-222222222222'}
 assert.deepEqual(readRestoreTarget(JSON.stringify(target)),{trainerId:target.trainerProfileId,athleteId:target.athleteProfileId})
 for(const value of [null,{}, {...target,athleteProfileId:target.trainerProfileId}, {...target,email:'synthetic@example.test'},
   {...target,trainerProfileId:'a'.repeat(64)}, {...target,trainerProfileId:3},
   {trainerEmailSha256:'a'.repeat(64),athleteEmailSha256:'b'.repeat(64)}])
   assert.throws(()=>readRestoreTarget(JSON.stringify(value)),/client_restore_target/)
 assert.throws(()=>readRestoreTarget('invalid'),/client_restore_target/)
})

test('plan and runtime role gates fail closed before application reads',async()=>{
 for(const row of [{username:'fit_owner',readonly:'off'},{username:'fit_api',readonly:'on'}]){
   const calls=[]
   await assert.rejects(planClientRestore({query:async sql=>{calls.push(sql);return{rows:[row]}}},{}),/owner_gate/)
   assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('public.')),false)
 }
 for(const row of [{username:'fit_owner',readonly:'on'},{username:'fit_api',readonly:'on',rolsuper:true,rolbypassrls:false}]){
   const calls=[]
   await assert.rejects(verifyClientRestore({query:async sql=>{calls.push(sql);return{rows:[row]}}},{}),/runtime_role/)
   assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('public.')),false)
 }
})

test('apply cannot run from malformed or substituted private plans',async()=>{
 for(const plan of [null,{}, {schema:1,ticket:'another-ticket'}]){
   let calls=0
   await assert.rejects(applyClientRestore({query:async()=>{calls++;return{rows:[]}}},plan,{backupVerified:true}),/client_restore_plan/)
   assert.equal(calls,0)
 }
})

test('transport is explicit trusted-main plan/apply/verify and keeps private receipts off artifacts',()=>{
 const source=readFileSync(new URL('../.github/workflows/restore-client-history.yml',import.meta.url),'utf8')
 assert.match(source,/options: \[prepare, plan, apply, verify\]/)
 assert.match(source,/RESTORE_CONFIRMED_CLIENT_TO_TRAINER/)
 assert.match(source,/Restore downloaded backup into a disposable PostgreSQL without network/)
 assert.match(source,/all\(\.\[\]; \.conclusion == "success"\)/)
 assert.match(source,/FIT_CLIENT_RESTORE_TARGETS/)
 const runtime=readFileSync(new URL('./cloudru-client-restore.mjs',import.meta.url),'utf8')
 assert.doesNotMatch(source+runtime,/supabase|readHistoryRegistry|cloudru-account-history-audit|\bfetch\(/i)
 assert.match(source,/test "\$GITHUB_REF" = refs\/heads\/main/)
 assert.match(source,/group: cloudru-stage-vm/)
 assert.match(source,/--cap-drop=ALL/)
 assert.match(source,/trap 'sudo rm -f/)
 assert.doesNotMatch(source,/pull_request:|schedule:|--privileged|GRANT|FIT_ACCOUNT_HISTORY_TARGETS|FIT_ACCOUNT_DELETION_TARGET/)
 assert.match(source,/if: inputs.phase == 'prepare'/)
 assert.match(source,/created before customer input/)
 assert.match(source,/prepare_run_id:/)
 assert.match(source,/git rev-parse "\$GITHUB_SHA:\$file"/)
 assert.match(source,/scripts\/cloudru-client-restore-private\.mjs scripts\/cloudru-journal-upload\.mjs/)
 assert.match(source,/phase:|RESTORE_PHASE/)
 assert.doesNotMatch(source,/inputs\.(trainer|athlete|client|digest|checksum)/)
})

test('runner GitHub reads work without gh installed and reject failed HTTP requests',()=>{
 const source=readFileSync(new URL('../.github/workflows/restore-client-history.yml',import.meta.url),'utf8')
 const helper=source.match(/          github_api\(\) \{\n[\s\S]*?\n          \}/)?.[0]
 assert.ok(helper)
 assert.doesNotMatch(source,/\bgh api\b/)
 const directory=mkdtempSync(join(tmpdir(),'fit-restore-runner-'))
 try{
   // The production runner has curl, but no GitHub CLI. Keep the test PATH equally narrow.
   writeFileSync(join(directory,'curl'),`#!/bin/sh
auth=false
bounded=false
previous=''
for arg do
  [ "$previous" != '--header' ] || [ "$arg" != 'Authorization: Bearer synthetic-token' ] || auth=true
  [ "$previous" != '--max-time' ] || [ "$arg" != '15' ] || bounded=true
  previous="$arg"
done
[ "$auth" = true ] && [ "$bounded" = true ] || exit 1
case "$arg" in
  https://api.github.com/repos/podkolzinpd/fit/commits/main) printf '{"sha":"synthetic-main"}' ;;
  *) exit 22 ;;
esac
`,{mode:0o700})
   const env={PATH:directory,GH_TOKEN:'synthetic-token',GITHUB_REPOSITORY:'podkolzinpd/fit'}
   const success=spawnSync('/bin/bash',['-e','-o','pipefail','-c',`${helper}\ngithub_api commits/main`],{env,encoding:'utf8'})
   assert.equal(success.status,0,success.stderr)
   assert.deepEqual(JSON.parse(success.stdout),{sha:'synthetic-main'})
   const failure=spawnSync('/bin/bash',['-e','-o','pipefail','-c',`${helper}\ngithub_api actions/runs/unavailable`],{env,encoding:'utf8'})
   assert.notEqual(failure.status,0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

const privateTarget={trainerProfileId:'11111111-1111-4111-8111-111111111111',athleteProfileId:'22222222-2222-4222-8222-222222222222'}
const privateExpected={clientId:'33333333-3333-4333-8333-333333333333',workoutIds:['44444444-4444-4444-8444-444444444444'],workouts:1,exercises:2,sets:3}
const operatorKeys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
const privatePayload={version:1,target:privateTarget,expectedHistory:privateExpected}
function parts(value){const encoded=Buffer.from(JSON.stringify(value)).toString('base64'),at=Math.ceil(encoded.length/2);return[encoded.slice(0,at),encoded.slice(at)]}
test('private input accepts only a bounded proven pair and exact imported history',()=>{
 const signed=privateRestoreInputParts(privatePayload,'123-1',operatorKeys.privateKey)
 assert.deepEqual(readPrivateRestoreInput(signed,'123-1',operatorKeys.publicKey),{pair:{trainerId:privateTarget.trainerProfileId,athleteId:privateTarget.athleteProfileId},expectedHistory:privateExpected})
 for(const value of [{...privatePayload,sql:'select 1'}, {...privatePayload,target:{...privateTarget,actor:'override'}},
   {...privatePayload,expectedHistory:{...privateExpected,workouts:2}}, {...privatePayload,expectedHistory:{...privateExpected,workoutIds:[...privateExpected.workoutIds,...privateExpected.workoutIds],workouts:2}},
   {...privatePayload,expectedHistory:{...privateExpected,sets:100001}}, {...privatePayload,version:2}])assert.throws(()=>readPrivateRestoreInput(parts(value),'123-1',operatorKeys.publicKey),/client_restore_/)
 for(const value of [[],['bad'],['%','%'],['YQ==','YQ==']])assert.throws(()=>readPrivateRestoreInput(value,'123-1',operatorKeys.publicKey))
})
test('private preparation never creates a database client or receives customer parameters',async()=>{
 let prepared=false
 const result=await executePrivateRestoreInput({phase:'prepare',session:'123-1',operatorPublicPem:'synthetic public key',
   store:{prepare:async(target,digest,session,key,options)=>{prepared=true;assert.equal(digest,clientRestoreInputDigest);assert.equal(session,'123-1');assert.equal(key,'synthetic public key');assert.deepEqual(options,{prepareReadback:true});assert.ok(Object.values(target).every(v=>v===clientRestoreInputDigest))}},
   createOwner:async()=>{assert.fail('no database during preparation')},savePlan:async()=>assert.fail('no customer plan during preparation')})
 assert.equal(prepared,true);assert.equal(result.customerInputReceived,false)
})
test('private plan rejects malformed input before any database access and closes only a persisted reply',async()=>{
 const events=[]
 await assert.rejects(executePrivateRestoreInput({phase:'plan',session:'123-1',store:{load:async()=>({parts:['bad','bad'],persistReceipt:async(state,value)=>{assert.equal(state,'readback');assert.equal(value.kind,'client_restore_private_plan_rejected');assert.ok(!JSON.stringify(value).includes(privateTarget.athleteProfileId));events.push('persist')},close:()=>events.push('close')}),cleanup:async()=>events.push('cleanup')},
   createOwner:async()=>assert.fail('no database for malformed input'),savePlan:async()=>assert.fail('no plan')}))
 assert.deepEqual(events,['persist','close','cleanup'])
 const failed=[]
 await assert.rejects(executePrivateRestoreInput({phase:'plan',session:'123-1',store:{load:async()=>({parts:['bad','bad'],persistReceipt:async()=>{throw Error('synthetic reply failure')},close:()=>failed.push('close')}),cleanup:async()=>failed.push('cleanup')},createOwner:async()=>assert.fail('no database'),savePlan:async()=>{}}),/synthetic reply failure/)
 assert.deepEqual(failed,['close'])
})
test('private reply access rejects foreign endpoints, objects, signatures and expiry',()=>{
 const base='https://s3.cloud.ru/fit-cloudru-stage-media-c2ad3760/operations/private-journal-import/123-1/'
 const query='?X-Amz-Expires=600&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature='+ 'a'.repeat(64)+'&X-Amz-SignedHeaders='
 const cap={session:'123-1',digest:clientRestoreInputDigest,url:base+'payload.encrypted.json'+query+'content-length%3Bhost%3Bif-none-match',readbackUrl:base+'readback.encrypted.json'+query+'host',bytes:131072,expiresAt:Date.now()+600000}
 assert.equal(validatePrivateRestoreCapability(cap,'123-1'),cap)
 for(const change of [{readbackUrl:cap.readbackUrl.replace('s3.cloud.ru','foreign.test')},{readbackUrl:cap.readbackUrl.replace('/123-1/','/124-1/')},{readbackUrl:cap.readbackUrl.replace('readback.encrypted.json','payload.encrypted.json')},{expiresAt:Date.now()-1},{digest:'b'.repeat(64)}])assert.throws(()=>validatePrivateRestoreCapability({...cap,...change},'123-1'))
})

test('private restore input is signed by the operator and bound to one preparation session',()=>{
 const signed=privateRestoreInputParts(privatePayload,'123-1',operatorKeys.privateKey)
 const value=JSON.parse(Buffer.from(signed.join(''),'base64').toString())
 assert.throws(()=>readPrivateRestoreInput(signed,'124-1',operatorKeys.publicKey))
 for(const change of [{expectedHistory:{...privateExpected,sets:4}}, {target:{...privateTarget,athleteProfileId:privateExpected.clientId}}, {signature:value.signature.slice(4)}])
   assert.throws(()=>readPrivateRestoreInput(parts({...value,...change}),'123-1',operatorKeys.publicKey),/private_signature/)
 const foreign=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
 assert.throws(()=>readPrivateRestoreInput(signed,'123-1',foreign.publicKey),/private_signature/)
})

test('private Actions results allow only technical flags, never customer fields or counts',()=>{
 const result=privateRestoreTechnicalResult({event:'client_restore_verified',bothCanReadImported:true,done:100,trainerId:'synthetic-private-id',clientEmail:'synthetic@example.test',plan:{private:'fixture'},unexpectedCustomerField:'hidden'})
 assert.deepEqual(result,{event:'client_restore_verified',bothCanReadImported:true})
})
