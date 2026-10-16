import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCloudruApiEnv } from './check-cloudru-api-env.mjs'
import { prepareNativeNutritionCohort } from './prepare-nutrition-native-cohort.mjs'

export function prepareCloudruNutrition(raw) {
  const cohort = prepareNativeNutritionCohort(raw)
  const parsed = JSON.parse(cohort)
  if (![4, 5].includes(parsed.clients.length) || parsed.trainers.length !== 2) throw new Error('nutrition_cohort_rejected')
  return cohort
}

export function mergeCloudruNutritionEnv(existing, raw, mode) {
  checkCloudruApiEnv(existing)
  if (!['enable', 'disable'].includes(mode)) throw new Error('nutrition_mode_rejected')
  const cohort = mode === 'enable' ? prepareCloudruNutrition(raw) : ''
  // Preserve all unrelated runtime values byte-for-byte, including AI/CORS/auth.
  const retained = existing.split('\n').filter(line => !/^NUTRITION_(ENABLED|LOGIN_COHORT)=/.test(line)).join('\n')
  const next = retained + (retained.endsWith('\n') ? '' : '\n')
    + `NUTRITION_ENABLED=${mode === 'enable'}\nNUTRITION_LOGIN_COHORT=${cohort}\n`
  checkCloudruApiEnv(next)
  return next
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2]
    if (mode === 'prepare' || mode === 'audit-cohort') {
      if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== 'podkolzinpd/fit') throw new Error('rejected')
      // stdout is piped exclusively into a private root-owned file, never logs.
      const raw = process.env.FIT_NUTRITION_ACCOUNT_COHORT
      const cohort = prepareCloudruNutrition(raw)
      process.stdout.write(mode === 'prepare' ? raw : `NUTRITION_ENABLED=true\nNUTRITION_LOGIN_COHORT=${cohort}\n`)
    } else {
      const id = process.argv[3]
      if (process.getuid() !== 0 || !/^[0-9]+-[0-9]+$/.test(id ?? '')) throw new Error('rejected')
      const raw = mode === 'enable' ? readFileSync(`/opt/fit/secrets/nutrition-input-${id}.json`, 'utf8') : ''
      const next = mergeCloudruNutritionEnv(readFileSync('/opt/fit/secrets/api.env', 'utf8'), raw, mode)
      writeFileSync(`/opt/fit/secrets/api-nutrition-next-${id}.env`, next, { flag: 'wx', mode: 0o600 })
    }
  } catch { console.error('cloudru_nutrition_configuration_failed'); process.exitCode = 1 }
}
