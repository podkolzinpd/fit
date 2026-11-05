import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export async function managePrivateAnalyticsAccess(client, action, hashes) {
  if (!['inspect', 'grant', 'revoke'].includes(action) || !Array.isArray(hashes) || hashes.length !== 2 || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) || hashes[0] === hashes[1]) throw Error('analytics_targets_invalid')
  await client.query(action === 'inspect' ? 'begin read only' : 'begin')
  try {
    await client.query("set local statement_timeout='5s'")
    await client.query("set local lock_timeout='2s'")
    if (action !== 'inspect') await client.query('select pg_advisory_xact_lock(189,1)')
    const outside = await client.query('select count(*)::int n from app_private.private_analytics_logins where enabled and not (login_sha256 = any($1::text[]))', [hashes])
    if (outside.rows[0]?.n !== 0) throw Error('analytics_other_enabled_accounts')
    if (action === 'grant') await client.query(`insert into app_private.private_analytics_logins(login_sha256,enabled)
      select value,true from unnest($1::text[]) value on conflict(login_sha256) do update set enabled=true`, [hashes])
    if (action === 'revoke') await client.query('update app_private.private_analytics_logins set enabled=false where login_sha256 = any($1::text[])', [hashes])
    const state = await client.query(`select count(*) filter(where enabled)::int enabled,
      count(*) filter(where enabled and subject_sha256 is not null)::int bound,
      count(*) filter(where enabled and exists(select 1 from app_private.auth_identities i where i.provider='yandex' and i.provider_subject_sha256=a.subject_sha256))::int ready
      from app_private.private_analytics_logins a where login_sha256 = any($1::text[])`, [hashes])
    const result = state.rows[0]
    if ((action === 'grant' && result.enabled !== 2) || (action === 'revoke' && result.enabled !== 0)) throw Error('analytics_access_postcondition_failed')
    await client.query('commit')
    return { status: action === 'inspect' ? 'inspected' : 'applied', ...result, otherEnabled: 0 }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw Error('analytics_operation_target_rejected')
    const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
    const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
    if (config?.host !== '10.70.10.67' || Number(config.port) !== 5432 || config.database !== 'fit' || config.user !== 'fit_owner') throw Error('analytics_connection_rejected')
    const { Pool } = createRequire('/app/package.json')('pg')
    pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000 })
    const client = await pool.connect()
    try { console.info(JSON.stringify(await managePrivateAnalyticsAccess(client, process.env.PRIVATE_ANALYTICS_ACTION, [process.env.PRIVATE_ANALYTICS_FIRST_HASH, process.env.PRIVATE_ANALYTICS_SECOND_HASH]))) }
    finally { client.release() }
  } catch {
    console.error('Private analytics access operation failed closed.')
    process.exitCode = 1
  } finally { if (pool) await pool.end() }
}
