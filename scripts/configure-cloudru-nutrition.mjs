import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCloudruApiEnv } from './check-cloudru-api-env.mjs'
import { prepareNativeNutritionCohort } from './prepare-nutrition-native-cohort.mjs'

export function prepareCloudruNutrition(raw) {
  const input = JSON.parse(raw)
  const cohortInput = Array.isArray(input) ? input : input.cohort
  const cohort = prepareNativeNutritionCohort(JSON.stringify(cohortInput))
  const parsed = JSON.parse(cohort)
  if (![4, 5].includes(parsed.clients.length) || parsed.trainers.length !== 2) throw new Error('nutrition_cohort_rejected')
  const barcodeLoginHash = Array.isArray(input) ? '' : input.barcodeLoginHash
  if (typeof barcodeLoginHash !== 'string' || !/^[0-9a-f]{64}$/.test(barcodeLoginHash)) throw new Error('nutrition_barcode_cohort_rejected')
  return { cohort, barcodeLoginHash }
}

export function mergeCloudruNutritionEnv(existing, raw, mode) {
  checkCloudruApiEnv(existing)
  if (!['enable', 'disable'].includes(mode)) throw new Error('nutrition_mode_rejected')
  const prepared = mode === 'enable' ? prepareCloudruNutrition(raw) : { cohort: '', barcodeLoginHash: '' }
  // Preserve all unrelated runtime values byte-for-byte, including AI/CORS/auth.
  const retained = existing.split('\n').filter(line => !/^NUTRITION_(ENABLED|LOGIN_COHORT|BARCODE_ENABLED|BARCODE_LOGIN_HASH)=/.test(line)).join('\n')
  const next = retained + (retained.endsWith('\n') ? '' : '\n')
    + `NUTRITION_ENABLED=${mode === 'enable'}\nNUTRITION_LOGIN_COHORT=${prepared.cohort}\nNUTRITION_BARCODE_ENABLED=${mode === 'enable'}\nNUTRITION_BARCODE_LOGIN_HASH=${prepared.barcodeLoginHash}\n`
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
      const barcodeLoginHash = process.env.FIT_NUTRITION_BARCODE_LOGIN_HASH
      const prepared = prepareCloudruNutrition(JSON.stringify({ cohort: JSON.parse(raw ?? ''), barcodeLoginHash }))
      process.stdout.write(mode === 'prepare' ? JSON.stringify({ cohort: JSON.parse(raw ?? ''), barcodeLoginHash }) : `NUTRITION_ENABLED=true\nNUTRITION_LOGIN_COHORT=${prepared.cohort}\nNUTRITION_BARCODE_ENABLED=true\n`)
    } else {
      const id = process.argv[3]
      if (process.getuid() !== 0 || !/^[0-9]+-[0-9]+$/.test(id ?? '')) throw new Error('rejected')
      const raw = mode === 'enable' ? readFileSync(`/opt/fit/secrets/nutrition-input-${id}.json`, 'utf8') : ''
      const next = mergeCloudruNutritionEnv(readFileSync('/opt/fit/secrets/api.env', 'utf8'), raw, mode)
      writeFileSync(`/opt/fit/secrets/api-nutrition-next-${id}.env`, next, { flag: 'wx', mode: 0o600 })
    }
  } catch { console.error('cloudru_nutrition_configuration_failed'); process.exitCode = 1 }
}
