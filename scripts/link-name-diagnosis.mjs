import { createRequire } from 'node:module'

// This one-off diagnostic deliberately returns no names, IDs, tokens or notes.
const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
const { Client } = createRequire('/app/package.json')('pg')
const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
if (config.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner') throw Error('unexpected_database')
const db = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 15000 })
await db.connect()
try {
  await db.query('begin transaction isolation level repeatable read read only')
  await db.query("set local statement_timeout='10s'")
  const state = (await db.query("select current_user u,current_setting('transaction_read_only') ro")).rows[0]
  if (state.u !== 'fit_owner' || state.ro !== 'on') throw Error('readonly_required')
  const profiles = (await db.query(`select id, account_role, created_at from public.profiles
    where (account_role='client' and lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ~ '(руфин|rufin)')
       or (account_role='trainer' and lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ~ '(георги|georg|adamov|адамов)')
    order by account_role,created_at limit 101`)).rows
  if (profiles.length > 100) throw Error('too_many_candidates')
  const clients = profiles.filter(p => p.account_role === 'client')
  const trainers = profiles.filter(p => p.account_role === 'trainer')
  const rows = (await db.query(`select r.status,r.connected_at,r.disconnected_at,
      r.disconnected_by=r.trainer_id disconnected_by_trainer,
      r.source_invitation_id is not null has_source_invitation,
      c.auth_user_id is not null has_account,c.archived_at is not null archived,
      c.merged_into_client_id is not null merged,
      (select count(*)::int from public.workouts w where w.client_id=c.id and w.deleted_at is null) workouts,
      (select count(*)::int from public.workouts w where w.client_id=c.id and w.deleted_at is not null) deleted_workouts,
      (select count(*)::int from app_private.trainer_connection_receipts x where x.relationship_id=r.id) receipts,
      (select count(*)::int from public.client_merge_operations m where (m.source_client_id=c.id or m.target_client_id=c.id) and m.status='completed') merges
    from public.client_trainer_relationships r join public.clients c on c.id=r.client_id
    where r.trainer_id=any($1::uuid[]) and c.auth_user_id=any($2::uuid[])
    order by r.connected_at limit 51`, [trainers.map(p=>p.id),clients.map(p=>p.id)])).rows
  if (rows.length > 50) throw Error('too_many_matches')
  console.log(JSON.stringify({event:'link_name_candidates',readOnly:true,athleteCandidates:clients.length,trainerCandidates:trainers.length,matchedRelationships:rows,identityVerified:false}))
  await db.query('commit')
} catch { await db.query('rollback'); console.error('link_name_diagnosis_failed'); process.exitCode=1 }
finally { await db.end() }
