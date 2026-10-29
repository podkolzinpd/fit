import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {readDeletionTarget,selectDeletionProfile,inspectDeletion,deletionResolution} from './cloudru-account-deletion.mjs'
const id='11111111-1111-4111-8111-111111111111'
test('target rejects contacts, SQL and malformed digests',()=>{for(const v of ['',null,'user@example.test','a'.repeat(63),'A'.repeat(64),'delete from profiles'])assert.throws(()=>readDeletionTarget(v));assert.equal(readDeletionTarget('a'.repeat(64)),'a'.repeat(64))})
test('identity must resolve uniquely across legacy and retained bindings',()=>{assert.equal(selectDeletionProfile(id,[{profile_id:id}]),id);assert.throws(()=>selectDeletionProfile(null,[]));assert.throws(()=>selectDeletionProfile(id,[{profile_id:'22222222-2222-4222-8222-222222222222'}]));assert.throws(()=>selectDeletionProfile('not-a-uuid',[]))})
test('inspection refuses writable connection and rolls back',async()=>{const calls=[];await assert.rejects(inspectDeletion({async query(sql){calls.push(sql);return{rows:[{username:'fit_owner',readonly:'off'}]}}},'a'.repeat(64),id),/readonly_required/);assert.equal(calls.at(-1),'rollback');assert.ok(calls[0].endsWith('read only'))})
test('inspection transport stays manual, private and bounded',()=>{const s=readFileSync(new URL('../.github/workflows/manage-account-deletion.yml',import.meta.url),'utf8');assert.match(s,/workflow_dispatch/);assert.doesNotMatch(s,/schedule:|pull_request:|inputs:|--privileged/);assert.match(s,/refs\/heads\/main/);assert.match(s,/FIT_ACCOUNT_DELETION_TARGET_SHA256: \$\{\{ secrets\./);assert.match(s,/--read-only/);assert.match(s,/trap 'sudo rm -f/);assert.match(s,/group: cloudru-stage-vm/)})

test('reports missing and conflicting matches distinctly without exposing identifiers',()=>{
 assert.deepEqual(deletionResolution(null,[]),{state:'missing',candidates:0,bindingProfiles:0})
 assert.deepEqual(deletionResolution(id,[{profile_id:id},{profile_id:id}]),{state:'unique',candidates:1,bindingProfiles:1})
 const conflict=deletionResolution(id,[{profile_id:'22222222-2222-4222-8222-222222222222'}])
 assert.deepEqual(conflict,{state:'conflict',candidates:2,bindingProfiles:1})
 assert.ok(!JSON.stringify(conflict).includes(id))
 assert.throws(()=>deletionResolution('invalid',[]))
})
