import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export async function resolveClientWorkoutProfiles(client, cohort) {
  if (!cohort || !Array.isArray(cohort.clients) || !Array.isArray(cohort.trainers)
    || cohort.clients.length !== 5 || cohort.trainers.length !== 2
    || new Set([...cohort.clients, ...cohort.trainers]).size !== 7
    || [...cohort.clients, ...cohort.trainers].some(x => !/^[a-f0-9]{64}$/.test(x))) throw new Error('client_workout_cohort_rejected')
  await client.query('begin read only')
  try {
    await client.query("set local statement_timeout = '5s'")
    await client.query("set local lock_timeout = '2s'")
    const settings = await client.query("select current_setting('transaction_read_only') as readonly")
    if (settings.rows[0]?.readonly !== 'on') throw new Error('client_workout_readonly_required')
    const result = await client.query(`select b.login_sha256 as hash, b.profile_id::text as id,
      p.account_role as role, a.enabled
      from app_private.nutrition_native_bindings b
      join public.profiles p on p.id = b.profile_id and p.account_role = b.account_role
      join app_private.profile_rollout_assignments a on a.profile_id = p.id
      where b.login_sha256 = any($1::text[]) limit 8`, [[...cohort.clients, ...cohort.trainers]])
    const rows = result.rows
    if (rows.length !== 7 || new Set(rows.map(r => r.id)).size !== 7 || new Set(rows.map(r => r.hash)).size !== 7
      || rows.filter(r => r.role === 'client').length !== 5 || rows.filter(r => r.role === 'trainer').length !== 2
      || rows.some(r => !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.id) || r.enabled !== true
        || !(r.role === 'client' ? cohort.clients : r.role === 'trainer' ? cohort.trainers : []).includes(r.hash))) {
      throw new Error('client_workout_profiles_not_ready')
    }
    await client.query('commit')
    return { clientProfileIds: rows.filter(r => r.role === 'client').map(r => r.id).sort(),
      trainerProfileIds: rows.filter(r => r.role === 'trainer').map(r => r.id).sort() }
  } catch (error) { await client.query('rollback'); throw error }
}

export function clientWorkoutInspectionFailure(error, phase) {
  const known = new Set(['client_workout_cohort_rejected', 'client_workout_readonly_required', 'client_workout_profiles_not_ready', 'client_workout_target_rejected', 'client_workout_database_rejected', 'client_workout_readback_differs'])
  const stage = ['target', 'connection', 'profiles', 'readback', 'artifact'].includes(phase) ? phase : 'unknown'
  const reason = known.has(error?.message) ? error.message : ['28P01', '42501', '42P01', '42703', 'ECONNREFUSED', 'ETIMEDOUT', 'EACCES', 'EEXIST', 'ERR_MODULE_NOT_FOUND'].includes(error?.code) ? error.code : 'unclassified'
  return `client_workout_profile_inspection_failed_closed phase=${stage} reason=${reason}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = 'target'
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw new Error('client_workout_target_rejected')
    phase = 'connection'
    const { buildDatabaseConnectionConfig } = await import('/app/dist/db/connection-config.js')
    const config = buildDatabaseConnectionConfig('MIGRATION_DATABASE')
    if (config?.host !== '10.70.10.67' || config.port !== 5432 || config.database !== 'fit'
      || config.user !== 'fit_owner' || process.env.MIGRATION_DATABASE_SSL_MODE !== 'require') throw new Error('client_workout_database_rejected')
    const { Client } = createRequire('/app/package.json')('pg')
    const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 5000 })
    await client.connect()
    try {
      phase = 'profiles'
      const cohort = JSON.parse(process.env.CLIENT_WORKOUT_LOGIN_COHORT ?? '')
      const first = await resolveClientWorkoutProfiles(client, cohort)
      phase = 'readback'
      const second = await resolveClientWorkoutProfiles(client, cohort)
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('client_workout_readback_differs')
      phase = 'artifact'
      writeFileSync('/result/client-workout-pilot-ids.json', JSON.stringify(first) + '\n', { flag: 'wx', mode: 0o600 })
      console.log('Verified five existing test-client profiles and two trainer profiles; read only, no admission changes.')
    } finally { await client.end() }
  } catch (error) { console.error(clientWorkoutInspectionFailure(error, phase)); process.exitCode = 1 }
}
