import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readNutritionAccounts } from './inspect-nutrition-pilot.mjs'

export function nativeNutritionKey(value) {
  let key = value.trim().toLowerCase()
  if (key.endsWith('@yandex.ru')) key = key.slice(0, -10)
  if (!key.includes('@')) {
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(key)) throw new Error('Invalid native cohort identity')
    key = key.replaceAll('.', '-')
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) throw new Error('Invalid native cohort identity')
  return createHash('sha256').update(key).digest('hex')
}

export function prepareNativeNutritionCohort(raw, expected) {
  const accounts = readNutritionAccounts(raw, expected)
  const result = { clients: accounts.filter(x => x.role === 'client').map(x => nativeNutritionKey(x.email)),
    trainers: accounts.filter(x => x.role === 'trainer').map(x => nativeNutritionKey(x.email)) }
  if (new Set([...result.clients, ...result.trainers]).size !== 5) throw new Error('Native cohort identities must be distinct')
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
      process.stdout.write('Prepared the approved native three-client/two-trainer cohort; no identities or access changed.\n')
    } else {
      appendFileSync(process.env.GITHUB_ENV, 'TF_VAR_nutrition_login_cohort=\n')
      process.stdout.write('Nutrition remains disabled.\n')
    }
  } catch {
    process.stderr.write('Native nutrition cohort preparation failed closed\n')
    process.exitCode = 1
  }
}
