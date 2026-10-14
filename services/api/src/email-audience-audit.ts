import { pathToFileURL } from 'node:url'
import { buildDatabaseConnectionConfig } from './db/connection-config.js'
import { PgDatabasePool } from './db/pg-pool.js'

interface LegacyUser { id: string; email?: string; email_confirmed_at?: string | null; banned_until?: string | null; deleted_at?: string | null }
export function aggregateEmailAudience(users: readonly LegacyUser[], profiles: ReadonlySet<string>, pushUsers: ReadonlySet<string>) {
  const matched = users.filter(user => profiles.has(user.id))
  const withEmail = users.filter(user => Boolean((user.email ?? '').trim()))
  const matchedWithEmail = matched.filter(user => Boolean((user.email ?? '').trim()))
  const unique = (rows: readonly LegacyUser[]) => new Set(rows.map(user => user.email!.trim().toLowerCase())).size
  return { currentProfiles: profiles.size, registeredAccounts: users.length,
    registeredAccountsWithEmail: withEmail.length, uniqueRegisteredEmails: unique(withEmail),
    registeredAccountsWithoutEmail: users.length - withEmail.length,
    matchedCurrentProfiles: matched.length, currentProfilesWithRegisteredEmail: matchedWithEmail.length,
    uniqueRegisteredEmailsForCurrentProfiles: unique(matchedWithEmail),
    currentProfilesWithRegisteredEmailWithoutPush: matchedWithEmail.filter(user => !pushUsers.has(user.id)).length }
}

async function getJson(url: string, key: string, apiKey = false): Promise<unknown> {
  const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, ...(apiKey ? { apikey: key } : {}) } })
  if (!response.ok) throw new Error('email_audit_source_unavailable')
  return response.json()
}
async function main() {
  const ref = process.env.SUPABASE_PROJECT_ID ?? ''
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (!/^[a-z]{20}$/.test(ref) || !token) throw new Error('email_audit_source_required')
  const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
  if (!config || config.host !== '10.70.10.67' || config.database !== 'fit'
    || config.user !== 'fit_owner' || config.port !== 5432) throw new Error('email_audit_target_required')
  const keys = await getJson(`https://api.supabase.com/v1/projects/${ref}/api-keys`, token)
  if (!Array.isArray(keys)) throw new Error('email_audit_keys_invalid')
  const entries = keys as unknown[]
  const entry = entries.find(item => typeof item === 'object' && item !== null
    && 'name' in item && item.name === 'service_role') as Record<string, unknown> | undefined
  const key = entry?.api_key
  if (typeof key !== 'string' || !key) throw new Error('email_audit_key_missing')
  const users: LegacyUser[] = []
  const seen = new Set<string>()
  let complete = false
  for (let page = 1; page <= 100; page++) {
    const result = await getJson(`https://${ref}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`, key, true) as { users?: LegacyUser[] }
    if (!Array.isArray(result.users)) throw new Error('email_audit_users_invalid')
    for (const user of result.users) {
      if (typeof user.id !== 'string' || seen.has(user.id)) throw new Error('email_audit_pagination_invalid')
      seen.add(user.id)
      users.push(user)
    }
    if (result.users.length < 1000) { complete = true; break }
  }
  if (!complete) throw new Error('email_audit_pagination_limit')
  const pool = new PgDatabasePool({ ...config, max: 1 }, 'migration-owner')
  const connection = await pool.connect()
  try {
    await connection.query('begin transaction isolation level repeatable read read only')
    await connection.query("set local statement_timeout = '15s'")
    const profiles = await connection.query<{ id: string }>('select id from public.profiles')
    const push = await connection.query<{ user_id: string }>('select distinct user_id from public.push_subscriptions')
    const counts = aggregateEmailAudience(users, new Set(profiles.map(row => row.id)), new Set(push.map(row => row.user_id)))
    await connection.query('commit')
    console.log(JSON.stringify({ action: 'email-audit', ...counts, sentEmails: 0,
      note: 'Counts all non-empty registered emails regardless of confirmation, syntax or account status; no mail sent.' }))
  } finally { connection.release(); await pool.end() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Email audience audit failed; private source details suppressed.'); process.exitCode = 1 })
}
