import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {readRestoreTarget,planClientRestore,applyClientRestore,verifyClientRestore} from './cloudru-client-restore.mjs'

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
 assert.match(source,/options: \[plan, apply, verify\]/)
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
 assert.doesNotMatch(source,/upload-artifact|pull_request:|schedule:|--privileged|GRANT|FIT_ACCOUNT_HISTORY_TARGETS|FIT_ACCOUNT_DELETION_TARGET/)
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
