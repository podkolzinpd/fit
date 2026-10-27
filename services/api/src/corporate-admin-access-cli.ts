import { Pool } from 'pg'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'

// An owner-only operation, never imported by server.ts or exposed over HTTP.
// Credentials are read from the migration environment, never from user input.
async function main() {
  const args=process.argv.slice(2)
  const profileId=args.find(v=>v.startsWith('--profile-id='))?.slice('--profile-id='.length)
  const grant=args.includes('--grant'), revoke=args.includes('--revoke')
  if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId) || grant===revoke) {
    throw new Error('Use --profile-id=<existing-profile-id> and exactly one of --grant or --revoke. Default is dry-run; --apply commits.')
  }
  const config=buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (!config) throw new Error('migration_owner_connection_required')
  const pool=new Pool({...config,max:1})
  const client=await pool.connect()
  try {
    await client.query('begin')
    const target=await client.query('select id from public.profiles where id=$1 for update',[profileId])
    if(target.rowCount!==1) throw new Error('existing_profile_required')
    await client.query(`insert into app_private.corporate_admins(profile_id,enabled) values($1,$2)
      on conflict(profile_id) do update set enabled=excluded.enabled`,[profileId,grant])
    const result=await client.query<{enabled:boolean}>('select enabled from app_private.corporate_admins where profile_id=$1',[profileId])
    if(result.rowCount!==1 || result.rows[0]?.enabled!==grant) throw new Error('admin_access_not_saved')
    await client.query(args.includes('--apply')?'commit':'rollback')
    console.info(JSON.stringify({status:args.includes('--apply')?'applied':'dry_run',enabled:grant}))
  } catch (error) { await client.query('rollback'); throw error }
  finally { client.release(); await pool.end() }
}
main().catch(()=>{console.error('Admin access operation failed. Check the existing profile and migration-owner connection. No credentials or account details are logged.');process.exitCode=1})
