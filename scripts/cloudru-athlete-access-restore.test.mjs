import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {planAthleteRestore,applyAthleteRestore,verifyAthleteRestore,readAthleteRestoreTargets,planAthleteRestoreFromEvidence} from './cloudru-athlete-access-restore.mjs'

const source=readFileSync(new URL('./cloudru-athlete-access-restore.mjs',import.meta.url),'utf8')
const workflow=readFileSync(new URL('../.github/workflows/restore-athlete-access.yml',import.meta.url),'utf8')
test('read-only planning checks the owner role before inventory and rolls back without mutation',async()=>{
 const calls=[]
 const client={query:async sql=>{calls.push(sql);return {rows:sql.startsWith('select current_user')?[{username:'fit_api',readonly:'on'}]:[]}}}
 await assert.rejects(planAthleteRestore(client,{}),/owner_gate/)
 assert.equal(calls.at(-1),'rollback')
 assert.equal(calls.some(s=>/^(update|insert|delete)/i.test(s)),false)
})
test('a verified backup and a fresh immutable ready plan are mandatory before any write',async()=>{
 let queried=false;const client={query:async()=>{queried=true;throw Error('unexpected query')}}
 await assert.rejects(applyAthleteRestore(client,{}),/backup_required/)
 await assert.rejects(applyAthleteRestore(client,{ready:false},{backupVerified:true}),/plan/)
 assert.equal(queried,false)
})
test('visibility verification cannot use owner or bypass-RLS credentials',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);return {rows:[{username:'fit_owner',readonly:'on',rolsuper:false,rolbypassrls:false}]}}}
 await assert.rejects(verifyAthleteRestore(client,{}),/runtime_role/)
 assert.equal(calls.at(-1),'rollback')
 assert.equal(calls.some(s=>s.includes('set_config')),false)
})
test('only one card and a proven same-person chat participant may change; message history and identities never change',()=>{
 const writes=[...source.matchAll(/(?:client|runtime)\.query\(`?\s*(update|insert|delete)\b([^`]*?)(?:`)/gi)]
 assert.equal(writes.length,2)
 assert.match(writes[0][0],/update public\.clients set auth_user_id=\$1,version=version\+1/)
 assert.match(writes[0][0],/auth_user_id=\$3 and version=\$4 returning id/)
 assert.match(writes[1][0],/update public\.chat_conversations set client_user_id=\$1/)
 assert.match(writes[1][0],/client_user_id=\$3 and trainer_id=\$4 and client_id=any\(\$5::uuid\[\]\) returning id/)
 assert.doesNotMatch(source,/(?:update|insert into|delete from)\s+(?:app_private\.(?:auth_identities|yandex_app_sessions)|public\.(?:workouts|workout_exercises|workout_sets|profiles))/i)
 assert.match(source,/begin transaction isolation level serializable read write/)
 assert.match(source,/protected_state_changed/)
 assert.match(source,/old_private_data/)
 assert.doesNotMatch(source,/(?:update|insert into|delete from)\s+public\.chat_(?:messages|meetings|meeting_sessions|meeting_notices)/i)
 assert.match(source,/old\.length===1/)
 assert.match(source,/oldAuthored===0/)
 assert.match(source,/plan\.state\.authorship\?\.legacyWorkouts===0/)
 assert.match(source,/old_authored_workouts/)
 assert.match(source,/metadata_digest/)
 assert.match(source,/runtime_chat_threads/)
})
test('native and current profile proof are required and unknown private history prevents a ready plan',()=>{
 assert.match(source,/resolveHistoryEvidence\(client,evidence\)/)
 assert.match(source,/current\.kinds\.includes\('feedback'\)/)
 assert.doesNotMatch(source,/SUPABASE_|readHistoryRegistry|readHistoryTargets|sourceJson|fetch\(/)
 assert.match(source,/p\.origin==='native'/)
 assert.match(source,/uncovered=state\.references\.filter\(r=>r\.legacy>0&&!r\.covered\)/)
 assert.match(source,/ready:uncovered\.length===0/)
 assert.match(source,/legacy_session_active/)
 assert.match(source,/operationalMetadata\.has\(t\.name\)/)
 assert.doesNotMatch(source,/t\.schema==='app_private'\|\|/)
 assert.match(source,/deletion_pending/)
})
test('transport is fixed main-only, uses closed evidence, preserves backups and shares the normal VM lock',()=>{
 assert.match(workflow,/test "\$GITHUB_REPOSITORY" = podkolzinpd\/fit/)
 assert.match(workflow,/test "\$GITHUB_REF" = refs\/heads\/main/)
 assert.match(workflow,/test "\$\(hostname\)" = fit-stage-app/)
 assert.match(workflow,/group: cloudru-stage-vm/)
 assert.match(workflow,/cancel-in-progress: false/)
 assert.doesNotMatch(workflow,/SUPABASE_|FIT_ACCOUNT_HISTORY_TARGETS/)
 assert.match(workflow,/FIT_ATHLETE_RESTORE_TARGETS: \$\{\{ secrets\.FIT_ATHLETE_RESTORE_TARGETS/)
 assert.match(workflow,/FIT_ACCOUNT_HISTORY_EVIDENCE: \$\{\{ secrets\.FIT_ACCOUNT_HISTORY_EVIDENCE/)
 assert.match(workflow,/actions\/workflows\/ci\.yml\/runs\?branch=main&status=success/)
 assert.match(workflow,/Restore downloaded backup into a disposable PostgreSQL without network/)
 assert.match(workflow,/Back up only Cloud\.ru PostgreSQL into encrypted private Cloud\.ru S3/)
 assert.match(workflow,/RESTORE_PROVEN_ATHLETE_CARD_ACCESS/)
 assert.match(workflow,/completed_at \| fromdateiso8601/)
 assert.match(workflow,/test "\$\(sudo stat -c '%u:%a' "\$directory\/plan\.json"\)" = 0:600/)
 assert.doesNotMatch(workflow,/workflow_dispatch:\s*\n\s*inputs:[\s\S]*?\n\s+(email|profile_id|sql|user_id|token):/)
 assert.doesNotMatch(workflow,/upload-artifact|actions: write|contents: write|--privileged|--network=host/)
})

const targets={historicalProfileId:'10000000-0000-4000-8000-000000000001',trainerProfileId:'10000000-0000-4000-8000-000000000002'}
test('native targets require exactly two distinct confirmed UUIDs and reject the old contact-hash format',()=>{
 assert.deepEqual(readAthleteRestoreTargets(JSON.stringify(targets)),targets)
 for(const invalid of [undefined,'',null,[],{},'invalid', {...targets,extra:true},
  {...targets,trainerProfileId:targets.historicalProfileId},{...targets,historicalProfileId:'invalid'},
  [{label:'athleteLegacy',emailHash:'a'.repeat(64),role:'client'}]]){
  assert.throws(()=>readAthleteRestoreTargets(typeof invalid==='string'?invalid:JSON.stringify(invalid)),/^Error: athlete_restore_targets$/)
 }
})
test('native plan still requires authenticated feedback and refuses a profile-only proof without inventory or writes',async()=>{
 const calls=[]
 const client={query:async sql=>{
  calls.push(sql)
  if(sql.startsWith('select current_user'))return {rows:[{username:'fit_owner',readonly:'on'}]}
  if(sql.startsWith("select 'feedback'"))return {rows:[{kind:'profile',profile_id:targets.historicalProfileId,account_role:'client',marker_matches:true}]}
  return {rows:[]}
 }}
 const raw=JSON.stringify(targets)
 await assert.rejects(planAthleteRestoreFromEvidence(client,raw,''),/fresh_feedback_required/)
 assert.equal(calls.length,0)
 await assert.rejects(planAthleteRestoreFromEvidence(client,raw,JSON.stringify({idSha256:'a'.repeat(64),messageSha256:'b'.repeat(64)})),/fresh_feedback_required/)
 assert.equal(calls.at(-1),'rollback')
 assert.equal(calls.some(sql=>/^(update|insert|delete)/i.test(sql)),false)
 assert.equal(calls.some(sql=>sql.includes('pg_class')),false)
})
