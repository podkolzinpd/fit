import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readHistoryRegistry} from './cloudru-account-history-audit.mjs'
export function readDeletionTarget(raw){if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))throw Error('deletion_target_invalid');return raw}
export function selectDeletionProfile(legacyId,bindings){const ids=[...new Set([legacyId,...bindings.map(r=>r.profile_id)].filter(Boolean))];if(ids.length!==1||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ids[0]))throw Error('deletion_target_unresolved_or_ambiguous');return ids[0]}
export function deletionResolution(legacyId,bindings){
 const bound=[...new Set(bindings.map(row=>row.profile_id).filter(Boolean))]
 const ids=[...new Set([legacyId,...bound].filter(Boolean))]
 if(ids.some(id=>!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)))throw Error('deletion_target_unresolved_or_ambiguous')
 return{state:ids.length===0?'missing':ids.length===1?'unique':'conflict',candidates:ids.length,bindingProfiles:bound.length}
}
const quote=v=>'"'+v.replaceAll('"','""')+'"'
async function json(url,headers){const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('deletion_registry_unavailable');const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>5*1024*1024)throw Error('deletion_registry_too_large');chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
export async function inspectDeletion(client,hash,legacyId){
 await client.query('begin transaction isolation level repeatable read read only')
 try{
  await client.query("set local statement_timeout='10s'")
  const mode=(await client.query("select current_user username,current_setting('transaction_read_only') readonly")).rows[0]
  if(mode.username!=='fit_owner'||mode.readonly!=='on')throw Error('deletion_readonly_required')
  const bindings=(await client.query(`select profile_id from app_private.fit_lime_pilot_allowlist where login_sha256=$1 union select profile_id from app_private.trainer_schedule_v2_allowlist where login_sha256=$1 union select profile_id from app_private.nutrition_native_bindings where login_sha256=$1`,[hash])).rows
  const resolution=deletionResolution(legacyId,bindings)
  if(resolution.state!=='unique'){
    await client.query('commit')
    return{event:'account_deletion_preflight',readOnly:true,resolution:resolution.state,
      legacyMatch:Boolean(legacyId),retainedBindingProfiles:resolution.bindingProfiles,
      candidateProfiles:resolution.candidates,accountDeleted:false}
  }
  const id=selectDeletionProfile(legacyId,bindings)
  const profiles=(await client.query('select account_role from public.profiles where id=$1',[id])).rows
  const cards=(await client.query('select id from public.clients where auth_user_id=$1 or trainer_id=$1',[id])).rows
  if(cards.length>1000||profiles.length>1)throw Error('deletion_scope_exceeded')
  const refs=(await client.query(`select n.nspname schema,c.relname table_name,a.attname column_name,rc.relname parent_table,f.confdeltype action from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace join pg_class rc on rc.oid=f.confrelid join pg_namespace rn on rn.oid=rc.relnamespace cross join lateral unnest(f.conkey,f.confkey) k(child,parent) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.child join pg_attribute ra on ra.attrelid=rc.oid and ra.attnum=k.parent where f.contype='f' and rn.nspname='public' and rc.relname in ('profiles','clients','trainers') and n.nspname in ('public','app_private') order by 1,2,3`)).rows
  const counts=[]
  for(const ref of refs){const values=ref.parent_table==='clients'?cards.map(c=>c.id):[id];const count=Number((await client.query(`select count(*) count from ${quote(ref.schema)}.${quote(ref.table_name)} where ${quote(ref.column_name)}=any($1::uuid[])`,[values])).rows[0].count);if(count)counts.push({...ref,count})}
  await client.query('commit')
  return{event:'account_deletion_preflight',readOnly:true,legacyMatch:Boolean(legacyId),profilePresent:profiles.length===1,role:profiles[0]?.account_role??null,clientCards:cards.length,references:counts}
 }catch(e){await client.query('rollback');throw e}
}
async function main(){
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='podkolzinpd/fit')throw Error('deletion_environment_invalid')
 const hash=readDeletionTarget(process.env.FIT_ACCOUNT_DELETION_TARGET_SHA256),project=process.env.SUPABASE_PROJECT_ID
 if(!/^[a-z0-9]{20}$/.test(project??''))throw Error('deletion_environment_invalid')
 const keys=await json(`https://api.supabase.com/v1/projects/${project}/api-keys`,{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`})
 const key=keys.find(k=>k.name==='service_role')?.api_key;if(!key)throw Error('deletion_registry_unavailable')
 const matches=await readHistoryRegistry(page=>json(`https://${project}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`,{Authorization:`Bearer ${key}`,apikey:key}),[{emailHash:hash,label:'deletion',role:'client'}])
 const{buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js');const config=buildDatabaseConnectionConfig('MIGRATION_DATABASE')
 if(config.host!=='10.70.10.67'||config.port!==5432||config.database!=='fit'||config.user!=='fit_owner'||process.env.MIGRATION_DATABASE_SSL_MODE!=='require')throw Error('deletion_environment_invalid')
 const{Client}=createRequire('/app/package.json')('pg'),client=new Client({...config,connectionTimeoutMillis:5000,query_timeout:15000});await client.connect()
 try{console.log(JSON.stringify(await inspectDeletion(client,hash,matches[0]?.id??null)))}finally{await client.end()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(/^(deletion_(target_invalid|target_unresolved_or_ambiguous|readonly_required|scope_exceeded|environment_invalid|registry_unavailable|registry_too_large)|history_audit_registry_(invalid|ambiguous|incomplete))$/.test(e?.message)?e.message:'account_deletion_preflight_failed');process.exitCode=1})
