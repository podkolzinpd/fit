import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {sealUpload,openUpload} from './cloudru-journal-upload.mjs'

test('write workflow requires green exact-current-main CI and retains serialized execution',()=>{
  const s=readFileSync(new URL('../.github/workflows/import-cloudru-private-programs.yml',import.meta.url),'utf8')
  assert.match(s,/options: \[prepare, inspect, apply, verify, cleanup\]/u)
  assert.match(s,/test "\$commit" = "\$GITHUB_SHA"/u)
  assert.match(s,/if test "\$MODE" = apply; then/u)
  assert.match(s,/head_sha=\$GITHUB_SHA&event=push/u)
  assert.match(s,/\.status == "completed" and \.conclusion == "success"/u)
  assert.match(s,/group: cloudru-stage-vm\n  cancel-in-progress: false/u)
  assert.match(s,/secrets.FIT_ATHLETE_PROGRAM_HISTORY_TARGET/u)
  assert.doesNotMatch(s,/secrets.FIT_WORKOUT_HISTORY_TARGET/u)
  assert.match(s,/--read-only --user 0/u);assert.match(s,/--cap-drop=ALL/u)
})

test('GitHub receives only encrypted prepared/readback capability metadata, never receipt or journal bytes',()=>{
  const s=readFileSync(new URL('../.github/workflows/import-cloudru-private-programs.yml',import.meta.url),'utf8')
  const artifacts=s.slice(s.indexOf('uses: actions/upload-artifact@'))
  assert.match(artifacts,/\/capability.encrypted.json/u)
  assert.match(artifacts,/\/prepared-capability.encrypted.json/u)
  assert.doesNotMatch(artifacts,/\/session|journal\.json|receipt\.json|private\.pem|\.xlsx/u)
  const upload=readFileSync(new URL('./cloudru-journal-upload.mjs',import.meta.url),'utf8')
  assert.match(upload,/recoveryReadOnly=false/u)
  assert.match(upload,/recoveryReadOnly&&process.env.FIT_JOURNAL_IMPORT_MODE!=='verify'/u)
  const cleanup=upload.slice(upload.indexOf('export async function cleanupCloudruUpload'))
  assert.ok(cleanup.indexOf("program-write.verified.json")<cleanup.indexOf('unlinkSync'))
  assert.match(cleanup,/verified\.session!==session\|\|verified\.digest!==digest/u)
})

test('prepared commit proof is authenticated, session-bound and closed to the VM key',()=>{
  const keys=()=>generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const vm=keys(),other=keys(),session='123456-1'
  const plain={kind:'program_commit_proof',session,digest:'a'.repeat(64),receipt:{created:[{workoutId:'synthetic'}],ownerPreservedState:{card:{count:1,fingerprint:'synthetic'}}}}
  const sealed=sealUpload(plain,vm.publicKey,session)
  assert.deepEqual(openUpload(sealed,vm.privateKey,session),plain)
  assert.throws(()=>openUpload(sealed,other.privateKey,session))
  assert.throws(()=>openUpload(sealed,vm.privateKey,'123457-1'))
  assert.throws(()=>openUpload({...sealed,data:'AAAA'},vm.privateKey,session))
})
