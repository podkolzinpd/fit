import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export async function manageCorporateAdminAccess(client, action, loginHash, accessSlot = 1) {
  if (!['inspect','grant','revoke'].includes(action) || !/^[a-f0-9]{64}$/.test(loginHash)) throw new Error('admin_target_rejected')
  if (![1,2].includes(accessSlot)) throw new Error('admin_target_rejected')
  await client.query(action==='inspect'?'begin read only':'begin')
  try {
    await client.query("set local statement_timeout='5s'")
    await client.query("set local lock_timeout='2s'")
    if(action!=='inspect') await client.query('select pg_advisory_xact_lock(159,1)')
    const direct=await client.query('select count(*)::int n from app_private.corporate_admins where enabled')
    const other=await client.query('select count(*)::int n from app_private.corporate_admin_logins where enabled and login_sha256<>$1',[loginHash])
    if(direct.rows[0]?.n!==0 || ![0,1].includes(other.rows[0]?.n)) throw new Error('admin_exclusive_target_conflict')
    if(action==='grant') await client.query(`insert into app_private.corporate_admin_logins(login_sha256,access_slot) values($1,$2)
      on conflict(login_sha256) do update set enabled=true where corporate_admin_logins.access_slot=excluded.access_slot`,[loginHash,accessSlot])
    if(action==='revoke') await client.query('update app_private.corporate_admin_logins set enabled=false where login_sha256=$1 and access_slot=$2',[loginHash,accessSlot])
    const result=await client.query(`select enabled,subject_sha256 is not null bound,
      (select count(*)::int from app_private.auth_identities i
        where i.provider='yandex' and i.provider_subject_sha256=a.subject_sha256) ready_profiles
      from app_private.corporate_admin_logins a where a.login_sha256=$1 and a.access_slot=$2`,[loginHash,accessSlot])
    const row=result.rows[0]
    if((action==='grant' && row?.enabled!==true) || (action==='revoke' && row?.enabled===true)
      || (row && ![0,1].includes(row.ready_profiles))) throw new Error('admin_access_postcondition_failed')
    await client.query('commit')
    return {status:action==='inspect'?'inspected':'applied',enabled:row?.enabled===true,bound:row?.bound===true,
      readyProfiles:row?.ready_profiles??0,otherEnabledAdmins:other.rows[0].n}
  } catch(error) {await client.query('rollback'); throw error}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let pool
  try {
    if(process.env.GITHUB_REF!=='refs/heads/main' || process.env.GITHUB_REPOSITORY!=='podkolzinpd/fit') throw new Error('admin_operation_target_rejected')
    const {buildDatabaseConnectionConfig}=await import('/app/dist/db/connection-config.js')
    const config=buildDatabaseConnectionConfig('MIGRATION_DATABASE')
    if(config?.host!=='10.70.10.67' || Number(config.port)!==5432 || config.database!=='fit' || config.user!=='fit_owner') throw new Error('admin_connection_rejected')
    const {Pool}=createRequire('/app/package.json')('pg')
    pool=new Pool({...config,max:1,connectionTimeoutMillis:5000})
    const client=await pool.connect()
    try {
      const result=process.env.CORPORATE_ADMIN_SCOPE==='invitation-pilot'
        ?await manageCorporateInvitationPilot(client,process.env.CORPORATE_ADMIN_ACTION,process.env.CORPORATE_ADMIN_LOGIN_SHA256)
        :await manageCorporateAdminAccess(client,process.env.CORPORATE_ADMIN_ACTION,process.env.CORPORATE_ADMIN_LOGIN_SHA256,Number(process.env.CORPORATE_ADMIN_ACCESS_SLOT ?? 1))
      console.info(JSON.stringify(result))
    }
    finally {client.release()}
  } catch {console.error('Corporate admin operation failed closed. No account or credential data logged.');process.exitCode=1}
  finally {if(pool) await pool.end()}
}

export async function manageCorporateInvitationPilot(client, action, loginHash) {
  if (!['inspect','grant','revoke'].includes(action) || !/^[a-f0-9]{64}$/.test(loginHash)) throw Error('invitation_pilot_target_invalid')
  await client.query(action==='inspect'?'begin read only':'begin')
  try {
    await client.query("set local statement_timeout='5s'")
    await client.query("set local lock_timeout='2s'")
    if(action!=='inspect')await client.query('select pg_advisory_xact_lock(159,1)')
    const matches=await client.query(`select p.id from public.profiles p join public.trainers t on t.profile_id=p.id
      where p.account_role='trainer' and p.id in (
        select profile_id from app_private.fit_lime_pilot_allowlist where login_sha256=$1
        union select profile_id from app_private.trainer_schedule_v2_allowlist where login_sha256=$1
        union select profile_id from app_private.nutrition_native_bindings where login_sha256=$1
      ) and exists(select 1 from app_private.auth_identities i where i.provider='yandex' and i.profile_id=p.id) limit 2`,[loginHash])
    if(matches.rows.length!==1)throw Error('invitation_pilot_target_unresolved')
    const id=matches.rows[0].id
    if(action==='grant')await client.query(`insert into app_private.corporate_invitation_pilot_trainers(profile_id,enabled) values($1,true)
      on conflict(profile_id) do update set enabled=true`,[id])
    if(action==='revoke')await client.query('update app_private.corporate_invitation_pilot_trainers set enabled=false where profile_id=$1',[id])
    const result=await client.query('select enabled from app_private.corporate_invitation_pilot_trainers where profile_id=$1',[id])
    const enabled=result.rows[0]?.enabled===true
    if(action==='grant'&&!enabled||action==='revoke'&&enabled)throw Error('invitation_pilot_readback_failed')
    await client.query('commit')
    return{status:action==='inspect'?'inspected':'applied',uniqueTrainer:true,enabled}
  }catch(error){await client.query('rollback');throw error}
}
