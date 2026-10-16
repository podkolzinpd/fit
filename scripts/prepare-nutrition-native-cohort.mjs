import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readNutritionAccounts } from './inspect-nutrition-pilot.mjs'

// Owner-approved addition on 12.10.2026: four clients, same two trainers.
// Contacts remain in the private candidate; no production secret update here.
const expandedApprovedCohort = 'a75b87f06157423993065b3968a3e25c64a27373169ea82d036de299e92e0bd4'
// Owner-corrected seventh participant, 16.10.2026: replacement, not expansion.
// Only the aggregate digest is public; the superseded seven is not accepted.
// Prior five/six configurations remain valid for safe rollback.
const seventhApprovedCohort = 'd50ba3441619bf1966ece88aae1004b086491f9f4b4962c7203b32a1cc89e214'

export function nativeNutritionKey(value) {
  let key = value.trim().toLowerCase()
  if (key.endsWith('@yandex.ru')) key = key.slice(0, -10)
  if (!key.includes('@')) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key)) throw new Error('Invalid native cohort identity')
    // Underscore stays literal; never infer another dot/hyphen account.
    key = key.replaceAll('.', '-')
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) throw new Error('Invalid native cohort identity')
  return createHash('sha256').update(key).digest('hex')
}

export function prepareNativeNutritionCohort(raw, expected) {
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('Invalid private cohort') }
  const clientCount = Array.isArray(value) && value.length === 7 ? 5 : Array.isArray(value) && value.length === 6 ? 4 : 3
  const approved = clientCount === 5 ? seventhApprovedCohort : clientCount === 4 ? expandedApprovedCohort : undefined
  const accounts = readNutritionAccounts(raw, expected ?? approved, clientCount)
  const result = { clients: accounts.filter(x => x.role === 'client').map(x => nativeNutritionKey(x.email)),
    trainers: accounts.filter(x => x.role === 'trainer').map(x => nativeNutritionKey(x.email)) }
  if (new Set([...result.clients, ...result.trainers]).size !== accounts.length) throw new Error('Native cohort identities must be distinct')
  return JSON.stringify(result)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit'
      || !process.env.GITHUB_ENV) throw new Error('Native cohort preparation requires trusted main')
    if (process.env.TF_VAR_nutrition_enabled === 'true') {
      const value = prepareNativeNutritionCohort(process.env.FIT_NUTRITION_ACCOUNT_COHORT)
      // GitHub masks the private derived configuration before any later step.
      process.stdout.write(`::add-mask::${value}\n`)
      appendFileSync(process.env.GITHUB_ENV, `TF_VAR_nutrition_login_cohort=${value}\n`)
      process.stdout.write('Prepared the exact approved native cohort; no identities or access changed.\n')
    } else {
      appendFileSync(process.env.GITHUB_ENV, 'TF_VAR_nutrition_login_cohort=\n')
      process.stdout.write('Nutrition remains disabled.\n')
    }
  } catch {
    process.stderr.write('Native nutrition cohort preparation failed closed\n')
    process.exitCode = 1
  }
}
