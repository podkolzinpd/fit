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
