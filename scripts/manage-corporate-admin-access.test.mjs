import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {manageCorporateAdminAccess} from './manage-corporate-admin-access.mjs'
const hash='a'.repeat(64)
function database({conflict=false,fail=false}={}) {
 const calls=[]
 return {calls,async query(sql,args){calls.push({sql,args});
  if(sql.includes('corporate_admins where enabled')) return {rows:[{n:conflict?1:0}]}
  if(sql.includes('count(*)::int n')) return {rows:[{n:0}]}
  if(sql.includes('select enabled,subject')) return {rows:[{enabled:true,bound:false,ready_profiles:0}]}
  if(fail&&sql.startsWith('insert into')) throw new Error('synthetic_failure')
  return {rows:[]}
 }}
}
test('grants exactly one privately approved login and returns no identities',async()=>{
 const client=database();const result=await manageCorporateAdminAccess(client,'grant',hash)
 assert.deepEqual(result,{status:'applied',enabled:true,bound:false,readyProfiles:0,otherEnabledAdmins:0})
 assert.equal(JSON.stringify(result).includes(hash),false)
 assert.equal(client.calls.at(-1).sql,'commit')
 assert.deepEqual(client.calls.find(x=>x.sql.startsWith('insert into')).args,[hash,1])
})
test('refuses an existing unrelated administrator and rolls back',async()=>{
 const client=database({conflict:true})
 await assert.rejects(manageCorporateAdminAccess(client,'grant',hash),/exclusive_target_conflict/)
 assert.equal(client.calls.some(x=>x.sql.startsWith('insert into')),false)
 assert.equal(client.calls.at(-1).sql,'rollback')
})
test('rejects invalid targets before SQL and never commits a partial grant',async()=>{
 const client=database({fail:true})
 await assert.rejects(manageCorporateAdminAccess(client,'grant','bad'),/target_rejected/)
 assert.equal(client.calls.length,0)
 await assert.rejects(manageCorporateAdminAccess(client,'grant',hash),/synthetic_failure/)
 assert.equal(client.calls.at(-1).sql,'rollback')
})
test('inspection is read only; workflow is main-only, bounded and keeps the target private',async()=>{
 const client=database();await manageCorporateAdminAccess(client,'inspect',hash)
 assert.equal(client.calls[0].sql,'begin read only')
 assert.equal(client.calls.some(x=>x.sql.startsWith('insert into')),false)
 const workflow=readFileSync(new URL('../.github/workflows/manage-corporate-admin.yml',import.meta.url),'utf8')
 for(const text of ['refs/heads/main','cloudru-stage-vm','RUNNING_SHA','FIT_CORPORATE_ADMIN_LOGIN_SHA256','--read-only','--timeout=25','trap']) assert.ok(workflow.includes(text))
 assert.equal(workflow.includes('yndx-'),false)
})

test('additional slot preserves a separately enabled administrator',async()=>{
 const client=database();const query=client.query.bind(client)
 client.query=async(sql,args)=>sql.includes('login_sha256<>$1')?{rows:[{n:1}]}:query(sql,args)
 const result=await manageCorporateAdminAccess(client,'grant',hash,2)
 assert.equal(result.otherEnabledAdmins,1)
 assert.deepEqual(client.calls.find(x=>x.sql.startsWith('insert into')).args,[hash,2])
 assert.equal(client.calls.some(x=>/update.*where.*<>/.test(x.sql)),false)
})

test('five owner-approved slots preserve every other administrator and reject a sixth',async()=>{
 for(const slot of [3,4,5]){
  const client=database();const query=client.query.bind(client)
  client.query=async(sql,args)=>sql.includes('login_sha256<>$1')?{rows:[{n:4}]}:query(sql,args)
  const result=await manageCorporateAdminAccess(client,'grant',hash,slot)
  assert.equal(result.otherEnabledAdmins,4)
  assert.deepEqual(client.calls.find(x=>x.sql.startsWith('insert into')).args,[hash,slot])
  assert.equal(client.calls.some(x=>/update.*where.*<>/.test(x.sql)),false)
 }
 for(const slot of [0,6,1.5]){
  const client=database()
  await assert.rejects(manageCorporateAdminAccess(client,'grant',hash,slot),/target_rejected/)
  assert.equal(client.calls.length,0)
 }
 const client=database();const query=client.query.bind(client)
 client.query=async(sql,args)=>sql.includes('login_sha256<>$1')?{rows:[{n:5}]}:query(sql,args)
 await assert.rejects(manageCorporateAdminAccess(client,'grant',hash,5),/exclusive_target_conflict/)
 assert.equal(client.calls.some(x=>x.sql.startsWith('insert into')),false)
})

test('three new workflow choices use separate closed secrets and preserve the first two',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/manage-corporate-admin.yml',import.meta.url),'utf8')
 assert.ok(workflow.includes('options: [primary, additional, third, fourth, fifth]'))
 for(const [name,slot] of [['PRIMARY',1],['ADDITIONAL',2],['THIRD',3],['FOURTH',4],['FIFTH',5]]){
  const secret=name==='PRIMARY'?'FIT_CORPORATE_ADMIN_LOGIN_SHA256':`FIT_CORPORATE_ADMIN_${name}_LOGIN_SHA256`
  assert.ok(workflow.includes(`secrets.${secret}`))
  assert.ok(workflow.includes(`CORPORATE_ADMIN_LOGIN_SHA256=$${name}_ADMIN_LOGIN_SHA256; CORPORATE_ADMIN_ACCESS_SLOT=${slot}`))
 }
 assert.equal(workflow.includes('type: string'),false)
})

test('invitation pilot resolves exactly one linked trainer and never exposes identity',async()=>{
 const {manageCorporateInvitationPilot}=await import('./manage-corporate-admin-access.mjs')
 const calls=[]
 const client={async query(sql,args){calls.push({sql,args});if(sql.includes('select p.id'))return{rows:[{id:'private-profile'}]};if(sql.startsWith('select enabled'))return{rows:[{enabled:true}]};return{rows:[]}}}
 const result=await manageCorporateInvitationPilot(client,'grant',hash)
 assert.deepEqual(result,{status:'applied',uniqueTrainer:true,enabled:true})
 assert.equal(JSON.stringify(result).includes('private-profile'),false)
 assert.equal(calls.at(-1).sql,'commit')
 for(const rows of [[],[{id:'one'},{id:'two'}]]){
  const c={async query(sql){if(sql.includes('select p.id'))return{rows};return{rows:[]}}}
  await assert.rejects(manageCorporateInvitationPilot(c,'grant',hash),/target_unresolved/)
 }
})

test('service pilot is independent, requires current corporate eligibility and keeps identities private',async()=>{
 const {manageCorporateServicePilot}=await import('./manage-corporate-admin-access.mjs')
 for(const eligible of [true,false]){
  const calls=[]
  const client={async query(sql,args){calls.push({sql,args});if(sql.includes('select p.id'))return{rows:[{id:'private-trainer'}]};if(sql.includes(' eligible'))return{rows:[{eligible}]};if(sql.startsWith('select enabled'))return{rows:[{enabled:true}]};return{rows:[]}}}
  if(!eligible){await assert.rejects(manageCorporateServicePilot(client,'grant',hash),/ineligible/);assert.equal(calls.some(c=>c.sql.startsWith('insert')),false);assert.equal(calls.at(-1).sql,'rollback');continue}
  assert.deepEqual(await manageCorporateServicePilot(client,'grant',hash),{status:'applied',uniqueTrainer:true,enabled:true,eligible:true})
  assert.ok(calls.find(c=>c.sql.startsWith('insert into app_private.corporate_service_pilot_trainers')))
  assert.equal(calls.some(c=>/^(update|insert into) (public\.|app_private\.corporate_admin|app_private\.corporate_invitation)/.test(c.sql)),false)
  assert.equal(calls.at(-1).sql,'commit')
 }
 for(const rows of [[],[{id:'one'},{id:'two'}]]){
  const calls=[];const client={async query(sql){calls.push(sql);return{rows:sql.includes('select p.id')?rows:[]}}}
  await assert.rejects(manageCorporateServicePilot(client,'grant',hash),/target_unresolved/)
  assert.equal(calls.some(sql=>sql.startsWith('insert')),false);assert.equal(calls.at(-1),'rollback')
 }
 const reads=[];const inspector={async query(sql){reads.push(sql);if(sql.includes('select p.id'))return{rows:[{id:'private-trainer'}]};if(sql.includes(' eligible'))return{rows:[{eligible:false}]};return{rows:[]}}}
 assert.deepEqual(await manageCorporateServicePilot(inspector,'inspect',hash),{status:'inspected',uniqueTrainer:true,enabled:false,eligible:false})
 assert.equal(reads[0],'begin read only');assert.equal(reads.some(sql=>/^(insert|update)/.test(sql)),false)
})
