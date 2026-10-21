import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Explicit owner approval on 21.10.2026: exactly four confirmed targets may
// launch while this one approved client's native binding is pending. Contacts
// stay private; the complete approved client set is pinned, not an arbitrary subset.
export const pendingClientWorkoutLoginHash = '6d066220dea64fde80afc931c603074e9984be7c09e3f67c51364006fd146cd8'
const approvedClientSetDigest = '09930ba8dfa6b41e5eee8f58b303ed4668594bc8ab3cfcad7c23e67f044caebf'
const profileUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

export class ClientWorkoutProfilesNotReadyError extends Error {
  constructor(cohort, rows) {
    super('client_workout_profiles_not_ready')
    const ready = hashes => hashes.filter(hash => {
      const matches = rows.filter(row => row.hash === hash)
      const row = matches[0]
      return matches.length === 1 && row.enabled === true && profileUuid.test(row.id)
        && rows.filter(other => other.id === row.id).length === 1
        && row.role === (cohort.clients.includes(hash) ? 'client' : 'trainer')
    })
    const clients = ready(cohort.clients)
    this.readiness = { readyClients: clients.length, readyTrainers: ready(cohort.trainers).length,
      missingClientHashes: cohort.clients.filter(hash => !clients.includes(hash)) }
  }
}

export async function resolveClientWorkoutProfiles(client, cohort, { allowPendingTestClient = false } = {}) {
  if (!cohort || !Array.isArray(cohort.clients) || !Array.isArray(cohort.trainers)
    || cohort.clients.length !== 5 || cohort.trainers.length !== 2
    || new Set([...cohort.clients, ...cohort.trainers]).size !== 7
    || [...cohort.clients, ...cohort.trainers].some(x => !/^[a-f0-9]{64}$/.test(x))) throw new Error('client_workout_cohort_rejected')
  if (typeof allowPendingTestClient !== 'boolean' || (allowPendingTestClient
    && createHash('sha256').update([...cohort.clients].sort().join(',')).digest('hex') !== approvedClientSetDigest)) throw new Error('client_workout_cohort_rejected')
  const requiredClients = allowPendingTestClient ? cohort.clients.filter(hash => hash !== pendingClientWorkoutLoginHash) : cohort.clients
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
      join app_private.auth_identities i on i.profile_id = p.id and i.provider = 'yandex'
        and i.provider_subject_sha256 = b.subject_sha256
      join app_private.profile_rollout_assignments a on a.profile_id = p.id
        and a.target_backend = 'yandex' and a.access_mode = 'read_write'
      where b.login_sha256 = any($1::text[])
        and (b.account_role = 'client' and exists (select 1 from public.clients c
          where c.auth_user_id = p.id and c.merged_into_client_id is null and c.archived_at is null)
          or b.account_role = 'trainer' and exists (select 1 from public.trainers t where t.profile_id = p.id))
      limit 8`, [[...cohort.clients, ...cohort.trainers]])
    const rows = result.rows
    if (rows.length < requiredClients.length || rows.length > 7 || new Set(rows.map(r => r.id)).size !== rows.length || new Set(rows.map(r => r.hash)).size !== rows.length
      || rows.filter(r => r.role === 'client').length < requiredClients.length || rows.filter(r => r.role === 'client').length > 5
      || requiredClients.some(hash => !rows.some(r => r.hash === hash && r.role === 'client'))
      || rows.filter(r => r.role === 'trainer').length > 2
      || rows.some(r => !profileUuid.test(r.id) || r.enabled !== true
        || !(r.role === 'client' ? cohort.clients : r.role === 'trainer' ? cohort.trainers : []).includes(r.hash))) {
      throw new ClientWorkoutProfilesNotReadyError(cohort, rows)
    }
    await client.query('commit')
    return { readiness: new ClientWorkoutProfilesNotReadyError(cohort, rows).readiness,
      targetClientCount: 5, partialAuthorized: allowPendingTestClient, clientProfileIds: rows.filter(r => r.role === 'client').map(r => r.id).sort(),
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
      const inspectionOptions = { allowPendingTestClient: process.env.CLIENT_WORKOUT_ALLOW_PENDING_TEST_CLIENT === 'true' }
      const first = await resolveClientWorkoutProfiles(client, cohort, inspectionOptions)
      phase = 'readback'
      const second = await resolveClientWorkoutProfiles(client, cohort, inspectionOptions)
      if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('client_workout_readback_differs')
      phase = 'artifact'
      writeFileSync('/result/client-workout-pilot-ids.json', JSON.stringify(first) + '\n', { flag: 'wx', mode: 0o600 })
      writeFileSync('/result/client-workout-pilot-readiness.json', JSON.stringify(first.readiness) + '\n', { flag: 'wx', mode: 0o600 })
      console.log(JSON.stringify({ event: 'client_workout_profiles_verified', confirmedClients: first.clientProfileIds.length, targetClients: 5, partialAuthorized: first.partialAuthorized, readOnly: true }))
    } finally { await client.end() }
  } catch (error) {
    if (error instanceof ClientWorkoutProfilesNotReadyError) writeFileSync('/result/client-workout-pilot-readiness.json', JSON.stringify(error.readiness) + '\n', { flag: 'wx', mode: 0o600 })
    console.error(clientWorkoutInspectionFailure(error, phase)); process.exitCode = 1
  }
}
