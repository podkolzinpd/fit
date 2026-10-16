import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { mergeCloudruNutritionEnv, prepareCloudruNutrition } from './configure-cloudru-nutrition.mjs'

const base = 'DATABASE_HOST=10.70.10.67\nDATABASE_PORT=5432\nDATABASE_NAME=fit\nDATABASE_USER=fit_api\nDATABASE_SSL_MODE=require\nFIT_MEDIA_STORAGE_PROVIDER=cloudru\nFIT_AI_FUNCTIONS_ENABLED=false\nFIT_AI_SUMMARY_GENERATION_DISABLED=true\nCORS_ALLOWED_ORIGINS=https://fit-training.ru\nCLOUDRU_MEDIA_KEY_SECRET=synthetic\n'

test('nutrition disable preserves every unrelated value, removes only own cohort, and is idempotent', () => {
  const next = mergeCloudruNutritionEnv(base + 'NUTRITION_ENABLED=true\nNUTRITION_LOGIN_COHORT=old-private-value\n', '', 'disable')
  assert.equal(next, base + 'NUTRITION_ENABLED=false\nNUTRITION_LOGIN_COHORT=\n')
  assert.equal(mergeCloudruNutritionEnv(next, '', 'disable'), next)
})

test('Cloud.ru enable fails closed for malformed, substituted or differently sized private cohorts', () => {
  const synthetic = Array.from({ length: 6 }, (_, i) => ({ email: `synthetic-${i}@example.test`, role: i < 4 ? 'client' : 'trainer' }))
  const seven = [...synthetic, { email: 'fifth_client@yandex.ru', role: 'client' }]
  for (const raw of ['', '{}', '[]', JSON.stringify(synthetic), JSON.stringify(synthetic.slice(1)), JSON.stringify(seven)]) {
    assert.throws(() => prepareCloudruNutrition(raw))
    assert.throws(() => mergeCloudruNutritionEnv(base, raw, 'enable'))
  }
  assert.throws(() => mergeCloudruNutritionEnv(base, '', 'unknown'))
  assert.throws(() => mergeCloudruNutritionEnv(base.replace('fit_api', 'fit_owner'), '', 'disable'))
})

test('nutrition release uses green exact current main, existing runner, private staging, schema probe and rollback', () => {
  const workflow = readFileSync(new URL('../.github/workflows/configure-cloudru-nutrition.yml', import.meta.url), 'utf8')
  for (const contract of ['refs/heads/main', '.github/workflows/ci.yml', '.conclusion == "success"',
    'runs-on: [self-hosted, cloudru-stage]', 'group: cloudru-stage-vm', '/opt/fit/RUNNING_SHA',
    'secrets.FIT_NUTRITION_ACCOUNT_COHORT', 'install -m 600', 'prepare | sudo tee "$extra" >/dev/null',
    'trap rollback ERR INT TERM', 'trap cleanup EXIT', 'sudo cp -- "$previous" /opt/fit/secrets/api.env',
    'sudo mv -T -- "$next" /opt/fit/secrets/api.env', 'dist/cloudru-nutrition-smoke.js',
    'http://127.0.0.1:18082/v1/profile', 'http://127.0.0.1:18080/v1/profile']) assert.ok(workflow.includes(contract), contract)
  assert.equal(workflow.split('node dist/cloudru-nutrition-smoke.js').length - 1, 2)
  assert.ok(workflow.indexOf('node dist/cloudru-nutrition-bindings.js') < workflow.indexOf('switched=false'))
  assert.match(workflow, /secrets\.CLOUDRU_STAGE_DATABASE_CONFIG_JSON/)
  assert.match(workflow, /audit-cohort \| sudo tee -a "\$owner" >\/dev\/null/)
  assert.match(workflow, /trap 'sudo rm -f -- "\$owner"' EXIT/)
  assert.match(workflow, /if: inputs\.mode == 'enable' && steps\.cohort\.outputs\.audit_required == 'true'/)
  assert.match(workflow, /JSON\.parse\(process\.env\.FIT_NUTRITION_ACCOUNT_COHORT\)\.length === 7/)
  assert.match(workflow, /for origin in https:\/\/fit-training\.ru capacitor:\/\/localhost https:\/\/localhost; do/)
  assert.doesNotMatch(workflow, /for origin in [^\n]*www\./)
  assert.doesNotMatch(workflow, /id-token:|terraform|YC_TOKEN|read-cloudru-external|configure-cloudru-ai|--database|pg_dump/)
  const helper = readFileSync(new URL('./configure-cloudru-nutrition.mjs', import.meta.url), 'utf8')
  assert.match(helper, /GITHUB_REF !== 'refs\/heads\/main'/)
  assert.match(helper, /GITHUB_REPOSITORY !== 'podkolzinpd\/fit'/)
  assert.match(helper, /flag: 'wx', mode: 0o600/)
  const blocks = [...workflow.matchAll(/        run: \|\n((?:          [^\n]*\n|\n)+)/g)]
  assert.equal(blocks.length, 5)
  for (const block of blocks) {
    const script = block[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n')
    const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})
