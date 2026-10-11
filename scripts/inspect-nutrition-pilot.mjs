import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fingerprint of exactly the owner-approved three clients and two trainers.
// Emails are held in a private GitHub secret, never in source/logs/artifacts.
const approvedCohort = '18a070387b4d9b9dcfdfe65608f4b887cffb0a938b1c0ca1fa1221d14c25a668'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export function readNutritionAccounts(raw, expected = approvedCohort) {
  let accounts
  try { accounts = JSON.parse(raw) } catch { throw new Error('Invalid private cohort') }
  if (!Array.isArray(accounts) || accounts.length !== 5 || accounts.some(a => !a
    || Object.keys(a).sort().join(',') !== 'email,role'
    || !['client', 'trainer'].includes(a.role) || typeof a.email !== 'string'
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email))) throw new Error('Invalid private cohort')
  accounts = accounts.map(a => ({ role: a.role, email: a.email.trim().toLowerCase() }))
  if (new Set(accounts.map(a => a.email)).size !== 5
    || accounts.filter(a => a.role === 'client').length !== 3) throw new Error('Invalid private cohort')
  const digest = createHash('sha256').update(accounts.map(a => `${a.role}:${a.email}`).sort().join('\n')).digest('hex')
  if (digest !== expected) throw new Error('Unapproved private cohort')
  return accounts
}

export function resolveNutritionProfiles(accounts, users) {
  const profiles = accounts.map(a => {
    const matches = users.filter(u => typeof u.email === 'string' && u.email.trim().toLowerCase() === a.email)
    if (matches.length !== 1 || !uuid.test(matches[0].id)) throw new Error('Reviewed account missing or not unique')
    return { role: a.role, profileId: matches[0].id }
  })
  if (new Set(profiles.map(p => p.profileId)).size !== 5) throw new Error('Reviewed profiles must be distinct')
  return profiles
}

export async function verifyNutritionProfiles(profiles, inspect) {
  for (const p of profiles) {
    // Existing private IAM route, action=inspect only: no identity/session
    // mutation, role changes, assignment writes or trainer access grants.
    const result = await inspect({ action: 'inspect', profileId: p.profileId })
    if (result.status !== 'rollout_inspected' || result.accountRole !== p.role
      || result.domainReady !== true || result.identityLinked !== true
      || result.rolloutEnabled !== true) throw new Error('Reviewed Yandex profile is not ready or role mismatched')
  }
  return { clientProfileIds: profiles.filter(p => p.role === 'client').map(p => p.profileId),
    trainerProfileIds: profiles.filter(p => p.role === 'trainer').map(p => p.profileId) }
}

async function boundedJson(url, options = {}) {
  let response
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }) }
  catch { throw new Error('Private identity inspection network failure') }
  if (!response.ok) throw new Error(`Private identity inspection HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 10 * 1024 * 1024) throw new Error('Private identity inspection response too large')
  try { return JSON.parse(text) } catch { throw new Error('Invalid identity inspection response') }
}

export function readNutritionInspectionConfiguration(env) {
  const project = env.SUPABASE_PROJECT_ID?.trim()
  const migrationUrl = env.MIGRATION_URL?.trim().replace(/\/$/, '')
  if (!/^[a-z0-9]{20}$/.test(project ?? '')) throw new Error('Official legacy registry project configuration missing')
  // The provider returns the root invocation link with a trailing slash.
  // Normalize only that slash; never accept another host, path or redirect.
  if (!/^https:\/\/[a-z0-9]+\.containers\.yandexcloud\.net$/.test(migrationUrl ?? '')) {
    throw new Error('Official private runner root configuration missing')
  }
  if (!env.YC_TOKEN) throw new Error('Official private inspection IAM configuration missing')
  return { project, migrationUrl }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Inspection requires current main')
    const accounts = readNutritionAccounts(process.env.FIT_NUTRITION_ACCOUNT_COHORT)
    const { project, migrationUrl } = readNutritionInspectionConfiguration(process.env)
    let keys
    try { keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })) }
    catch { throw new Error('Legacy identity registry unavailable') }
    const key = keys.find(k => k.name === 'service_role' || k.name === 'secret')?.api_key
    if (typeof key !== 'string' || !key) throw new Error('Legacy identity registry credential unavailable')
    const matched = []
    let complete = false
    for (let page = 1; page <= 20; page++) {
      const result = await boundedJson(`https://${project}.supabase.co/auth/v1/admin/users?page=${page}&per_page=1000`,
        { headers: { Authorization: `Bearer ${key}`, apikey: key } })
      if (!Array.isArray(result.users)) throw new Error('Invalid identity registry page')
      for (const user of result.users) if (accounts.some(a => a.email === user.email?.trim().toLowerCase())) {
        matched.push({ id: user.id, email: user.email })
      }
      if (result.users.length < 1000) { complete = true; break }
    }
    if (!complete) throw new Error('Identity registry inspection exceeded its bounded scope')
    const profiles = resolveNutritionProfiles(accounts, matched)
    const inspect = body => boundedJson(`${migrationUrl}/stage/rollout-assignments/yandex`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.YC_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const first = await verifyNutritionProfiles(profiles, inspect)
    const second = await verifyNutritionProfiles(profiles, inspect)
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Identity inspection readback differs')
    writeFileSync('nutrition-pilot-ids.json', JSON.stringify(first)+'\n', { flag: 'wx', mode: 0o600 })
    console.log('Verified exactly three client and two trainer profiles in the official identity registry and Yandex runtime; no data or access changes.')
  } catch (error) {
    // No raw response, subprocess stderr, email, user record or credential.
    console.error(error.message)
    process.exitCode = 1
  }
}
