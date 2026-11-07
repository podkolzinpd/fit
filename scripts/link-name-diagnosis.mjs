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
  const cards = (await db.query(`with recursive scope as (
    select id,merged_into_client_id,array[id] path from public.clients
    where auth_user_id=any($1::uuid[]) or lower(full_name) ~ '(руфин|rufin)'
    union all select c.id,c.merged_into_client_id,s.path||c.id from scope s join public.clients c
      on c.id=s.merged_into_client_id or c.merged_into_client_id=s.id
      where not c.id=any(s.path) and cardinality(s.path)<12
    ) select distinct c.id,c.auth_user_id,c.trainer_id,c.archived_at,c.merged_into_client_id,c.created_at
      from public.clients c join scope s on s.id=c.id limit 51`, [clients.map(p=>p.id)])).rows
  if(cards.length > 50) throw Error('too_many_cards')
  const labels = new Map(cards.map((c,i)=>[c.id,`card${i+1}`]))
  const history = (await db.query(`select r.client_id,r.status,r.connected_at,r.disconnected_at,
      r.disconnected_by=r.trainer_id disconnected_by_trainer,r.source_invitation_id is not null has_source_invitation,
      (select count(*)::int from app_private.trainer_connection_receipts x where x.relationship_id=r.id) receipts,
      lower(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')) ~ '(георги|georg|adamov|адамов)' trainer_name_match
    from public.client_trainer_relationships r join public.profiles p on p.id=r.trainer_id
    where r.client_id=any($1::uuid[]) order by r.connected_at limit 101`, [cards.map(c=>c.id)])).rows
  const invites = (await db.query(`select client_id,created_at,claimed_at,revoked_at,expires_at,target_role,
    claimed_by=any($2::uuid[]) claimed_by_candidate from public.client_invitations
    where client_id=any($1::uuid[]) order by created_at limit 101`, [cards.map(c=>c.id),clients.map(p=>p.id)])).rows
  const workouts = (await db.query(`select client_id,status,deleted_at is not null deleted,count(*)::int count
    from public.workouts where client_id=any($1::uuid[]) group by client_id,status,deleted_at is not null limit 101`, [cards.map(c=>c.id)])).rows
  if ([history,invites,workouts].some(x=>x.length>100)) throw Error('too_many_events')
  const keyed = x=>x.map(({client_id,...rest})=>({card:labels.get(client_id),...rest}))
  console.log(JSON.stringify({event:'link_name_candidates',readOnly:true,athleteCandidates:clients.length,trainerCandidates:trainers.length,matchedRelationships:rows,
    cards:cards.map(c=>({card:labels.get(c.id),ownedByCandidate:clients.some(p=>p.id===c.auth_user_id),archived:!!c.archived_at,mergedInto:labels.get(c.merged_into_client_id)??null,createdAt:c.created_at})),
    history:keyed(history),invitations:keyed(invites),workouts:keyed(workouts),identityVerified:false}))
  await db.query('commit')
} catch { await db.query('rollback'); console.error('link_name_diagnosis_failed'); process.exitCode=1 }
finally { await db.end() }
