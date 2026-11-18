import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {readDeletionTarget,inspectDeletion,deletionResolution,readDeletionScope} from './cloudru-account-deletion.mjs'
const id='11111111-1111-4111-8111-111111111111'
test('target rejects contacts, SQL and malformed digests',()=>{for(const v of ['',null,'user@example.test','a'.repeat(63),'A'.repeat(64),'delete from profiles'])assert.throws(()=>readDeletionTarget(v));assert.equal(readDeletionTarget('a'.repeat(64)),'a'.repeat(64))})
test('inspection refuses writable connection and rolls back',async()=>{const calls=[];await assert.rejects(inspectDeletion({async query(sql){calls.push(sql);return{rows:[{username:'fit_owner',readonly:'off'}]}}},{emailHash:'a'.repeat(64),evidence:null}),/readonly_required/);assert.equal(calls.at(-1),'rollback');assert.ok(calls[0].endsWith('read only'))})
test('inspection transport stays manual, private and bounded',()=>{const s=readFileSync(new URL('../.github/workflows/manage-account-deletion.yml',import.meta.url),'utf8');assert.match(s,/workflow_dispatch/);assert.doesNotMatch(s,/schedule:|pull_request:|inputs:|--privileged|SUPABASE_/);assert.match(s,/refs\/heads\/main/);assert.match(s,/FIT_ACCOUNT_DELETION_TARGET_SHA256: \$\{\{ secrets\./);assert.match(s,/--read-only/);assert.match(s,/trap 'sudo rm -f/);assert.match(s,/group: cloudru-stage-vm/)})

test('reports missing and conflicting matches distinctly without exposing identifiers',()=>{
 assert.deepEqual(deletionResolution([]),{state:'missing',candidates:0})
 assert.deepEqual(deletionResolution([{profile_id:id},{profile_id:id}]),{state:'feedback_required',candidates:1})
 const conflict=deletionResolution([{profile_id:id},{profile_id:'22222222-2222-4222-8222-222222222222'}])
 assert.deepEqual(conflict,{state:'conflict',candidates:2})
 assert.ok(!JSON.stringify(conflict).includes(id))
 assert.throws(()=>deletionResolution([{profile_id:'invalid'}]))
})

test('private feedback scope requires both exact evidence hashes and no extra fields',()=>{
 const scope={emailHash:'a'.repeat(64),evidence:{idSha256:'b'.repeat(64),messageSha256:'c'.repeat(64)}}
 assert.deepEqual(readDeletionScope(JSON.stringify(scope)),scope)
 assert.deepEqual(readDeletionScope('a'.repeat(64)),{emailHash:'a'.repeat(64),evidence:null})
 for(const bad of [{...scope,profileId:'unexpected'},{...scope,evidence:{idSha256:'b'.repeat(64)}},{...scope,evidence:{...scope.evidence,messageSha256:'wrong'}}])assert.throws(()=>readDeletionScope(JSON.stringify(bad)))
})

test('a retained login alone cannot select an account for dependency inspection',async()=>{
 const statements=[]
 const report=await inspectDeletion({async query(sql){
  statements.push(sql)
  return {rows:sql.startsWith('select current_user')?[{username:'fit_owner',readonly:'on'}]:
    sql.includes('nutrition_native_bindings')?[{profile_id:id}]:[]}
 }},{emailHash:'a'.repeat(64),evidence:null})
 assert.equal(report.resolution,'feedback_required')
 assert.equal(report.accountDeleted,false)
 assert.ok(!JSON.stringify(report).includes(id))
 assert.ok(!statements.some(sql=>sql.includes('public.profiles')))
 assert.equal(statements.at(-1),'commit')
})
