import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {planAthleteRestore,applyAthleteRestore,verifyAthleteRestore} from './cloudru-athlete-access-restore.mjs'

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
test('the only business write changes one existing card; identities, sessions and histories are never rewritten',()=>{
 const writes=[...source.matchAll(/(?:client|runtime)\.query\(`?\s*(update|insert|delete)\b([^`]*?)(?:`)/gi)]
 assert.equal(writes.length,1)
 assert.match(writes[0][0],/update public\.clients set auth_user_id=\$1,version=version\+1/)
 assert.match(writes[0][0],/auth_user_id=\$3 and version=\$4 returning id/)
 assert.doesNotMatch(source,/(?:update|insert into|delete from)\s+(?:app_private\.(?:auth_identities|yandex_app_sessions)|public\.(?:workouts|workout_exercises|workout_sets|profiles))/i)
 assert.match(source,/begin transaction isolation level serializable read write/)
 assert.match(source,/protected_state_changed/)
 assert.match(source,/old_private_data/)
})
test('native and current profile proof are required and unknown private history prevents a ready plan',()=>{
 assert.match(source,/resolveHistoryEvidence\(client,readHistoryEvidenceSecret/)
 assert.match(source,/current\.kinds\.includes\('feedback'\)/)
 assert.match(source,/r\.label==='athleteLegacy'/)
 assert.match(source,/r\.label==='trainerLegacy'/)
 assert.match(source,/p\.origin==='native'/)
 assert.match(source,/uncovered=state\.references\.filter\(r=>r\.legacy>0&&!r\.covered\)/)
 assert.match(source,/ready:uncovered\.length===0/)
 assert.match(source,/legacy_session_active/)
 assert.match(source,/deletion_pending/)
})
test('transport is fixed main-only, uses closed evidence, preserves backups and shares the normal VM lock',()=>{
 assert.match(workflow,/test "\$GITHUB_REPOSITORY" = podkolzinpd\/fit/)
 assert.match(workflow,/test "\$GITHUB_REF" = refs\/heads\/main/)
 assert.match(workflow,/test "\$\(hostname\)" = fit-stage-app/)
 assert.match(workflow,/group: cloudru-stage-vm/)
 assert.match(workflow,/cancel-in-progress: false/)
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
