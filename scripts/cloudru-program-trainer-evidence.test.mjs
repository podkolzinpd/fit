import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readProgramTrainerEvidence,resolveProgramTrainer,programMatchNameHash} from './cloudru-program-trainer-evidence.mjs'
import {rosterOwnerQuery} from './cloudru-account-links-audit.mjs'

const hash=s=>createHash('sha256').update(s).digest('hex')
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
const target={trainerEmailSha256:hash('synthetic email'),trainerLoginSha256:hash('synthetic login'),clientNameSha256:hash('synthetic name')}
const evidence=()=>({version:1,targetBinding:hash(JSON.stringify([target.trainerEmailSha256,target.trainerLoginSha256,target.clientNameSha256])),
  rosterNameHashes:Array.from({length:17},(_,i)=>hash('synthetic roster '+i))})
const row=()=>({trainer_id:actor,account_role:'trainer',yandex_linked:true,matched_names:17,matched_cards:17,
  ambiguous_names:0,active_clients:19,matched_ordinals:Array.from({length:17},(_,i)=>i+1)})
function fixture({rows=[row()],username='fit_owner',readonly='on',bindings=[]}={}) {
  const calls=[]
  const owner={async query(sql,values){
    calls.push({sql,values})
    if(sql.includes('current_user username'))return {rows:[{username,readonly}]}
    if(sql===rosterOwnerQuery)return {rows}
    if(sql.includes('from pg_class'))return {rows:[{name:'synthetic_retained',binding_kind:'profile'}]}
    if(sql.includes('from app_private."synthetic_retained"'))return {rows:bindings.map(profile_id=>({profile_id,login_sha256:target.trainerLoginSha256}))}
    return {rows:[]}
  }}
  return {owner,calls}
}

test('separate evidence binds the original target and refuses actor IDs, unknown fields, partial or duplicate signatures',()=>{
  assert.equal(readProgramTrainerEvidence(undefined,target),null)
  assert.equal(readProgramTrainerEvidence('',target),null)
  const e=evidence();assert.deepEqual(readProgramTrainerEvidence(JSON.stringify(e),target),e)
  for(const mutate of [v=>v.actorId=actor,v=>v.sql='select 1',v=>v.version=2,v=>v.rosterNameHashes.pop(),
    v=>v.rosterNameHashes.push(hash('extra')),v=>v.rosterNameHashes[0]=v.rosterNameHashes[1]]) {
    const v=evidence();mutate(v);assert.throws(()=>readProgramTrainerEvidence(JSON.stringify(v),target),/evidence_invalid/u)
  }
  assert.throws(()=>readProgramTrainerEvidence(JSON.stringify(e),{...target,clientNameSha256:hash('changed')}),/target_mismatch/u)
})

test('one complete current roster resolves only after owner/readonly guards and agreement of retained and legacy sources',async()=>{
  const f=fixture({bindings:[actor]});const result=await resolveProgramTrainer(f.owner,target,actor,evidence())
  assert.equal(result.trainerId,actor);assert.equal(result.retainedLoginBinding,true)
  assert.deepEqual(result.identityEvidence,{method:'current_roster',targetNames:17,matchedCards:17,activeClients:19,
    retainedSourcesChecked:1,legacyRegistryMatched:true,sourcesAgree:true})
  assert.match(f.calls[0].sql,/repeatable read read only/u)
  assert.ok(f.calls.findIndex(c=>c.sql.includes('current_user username'))<f.calls.findIndex(c=>c.sql===rosterOwnerQuery))
  assert.equal(f.calls.at(-1).sql,'commit')
  assert.equal(f.calls.some(c=>/^(insert|update|delete|alter|create|drop)\b/iu.test(c.sql)),false)
})

test('missing retained email mapping does not prevent a unique complete roster with existing trainer/Yandex identity',async()=>{
  const f=fixture();const result=await resolveProgramTrainer(f.owner,target,null,evidence())
  assert.equal(result.trainerId,actor);assert.equal(result.retainedLoginBinding,false)
  assert.equal(result.yandexIdentityLinked,true)
})

test('role, Yandex, card/ordinal cardinality, partial roster and multiple owners fail closed',async()=>{
  const variants=[[],[row(),{...row(),trainer_id:other}],
    ...[{account_role:'client'},{yandex_linked:false},{matched_names:16},{matched_cards:16},{matched_cards:18},
      {ambiguous_names:1},{active_clients:16},{active_clients:1001},{matched_ordinals:[1,1,...Array.from({length:15},(_,i)=>i+3)]}]
      .map(change=>[{...row(),...change}])]
  for(const rows of variants){const f=fixture({rows});await assert.rejects(resolveProgramTrainer(f.owner,target,null,evidence()),/evidence_(trainer_ambiguous|roster_changed)/u);assert.equal(f.calls.at(-1).sql,'rollback')}
})

test('conflicting retained or legacy identity is rejected even when the whole roster matches',async()=>{
  for(const [bindings,legacy] of [[[other],null],[[actor,other],actor],[[],other]]) {
    const f=fixture({bindings});await assert.rejects(resolveProgramTrainer(f.owner,target,legacy,evidence()),/sources_disagree/u)
    assert.equal(f.calls.at(-1).sql,'rollback')
  }
})

test('wrong owner, non-readonly connection and mismatched private target never reach the roster query',async()=>{
  for(const change of [{username:'fit_api'},{readonly:'off'}]) {
    const f=fixture(change);await assert.rejects(resolveProgramTrainer(f.owner,target,null,evidence()),/readonly_required/u)
    assert.equal(f.calls.some(c=>c.sql===rosterOwnerQuery),false)
  }
  const f=fixture();const bad={...evidence(),targetBinding:hash('other target')}
  await assert.rejects(resolveProgramTrainer(f.owner,target,null,bad),/target_mismatch/u);assert.equal(f.calls.length,0)
})

test('only the separately reviewed F13 source spelling may resolve to one member of the verified roster',()=>{
  const e=evidence(),name='Synthetic source spelling';e.programAlias={code:'F13',sourceNameSha256:hash(name.toLowerCase()),rosterNameSha256:e.rosterNameHashes[0]}
  assert.deepEqual(readProgramTrainerEvidence(JSON.stringify(e),target),e)
  assert.equal(programMatchNameHash(e,{code:'F13',clientName:name}),e.rosterNameHashes[0])
  assert.equal(programMatchNameHash(e,{code:'F01',clientName:name}),null)
  assert.throws(()=>programMatchNameHash(e,{code:'F13',clientName:'Other source'}),/alias_source_mismatch/u)
  for(const change of [{code:'F01'},{rosterNameSha256:hash('outside roster')},{actorId:actor}]) {
    const bad=structuredClone(e);Object.assign(bad.programAlias,change)
    assert.throws(()=>readProgramTrainerEvidence(JSON.stringify(bad),target),/evidence_invalid/u)
  }
})
