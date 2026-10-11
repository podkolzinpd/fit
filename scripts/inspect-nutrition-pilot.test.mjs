import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readNutritionAccounts, resolveNutritionProfiles, verifyNutritionProfiles, readNutritionInspectionConfiguration } from './inspect-nutrition-pilot.mjs'

const accounts = Array.from({ length: 5 }, (_, i) => ({ email: `synthetic-${i}@example.test`, role: i < 3 ? 'client' : 'trainer' }))
const digest = a => createHash('sha256').update(a.map(x => `${x.role}:${x.email}`).sort().join('\n')).digest('hex')
const users = accounts.map((a, i) => ({ email: a.email, id: `10000000-0000-4000-8000-00000000000${i}` }))
const profiles = resolveNutritionProfiles(accounts, users)
test('private inspection accepts the official root URL with or without a trailing slash, never another origin or path', () => {
  const ready = { SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst', MIGRATION_URL: 'https://synthetic123.containers.yandexcloud.net', YC_TOKEN: 'synthetic-iam-test-only' }
  for (const suffix of ['', '/']) {
    assert.deepEqual(readNutritionInspectionConfiguration({ ...ready, MIGRATION_URL: ready.MIGRATION_URL + suffix }),
      { project: ready.SUPABASE_PROJECT_ID, migrationUrl: ready.MIGRATION_URL })
  }
  for (const bad of ['http://synthetic123.containers.yandexcloud.net/', 'https://example.test/',
    ready.MIGRATION_URL + '/stage', ready.MIGRATION_URL + '//', ready.MIGRATION_URL + '/?q=x',
    ready.MIGRATION_URL + '/#fragment', 'https://userinfo@synthetic123.containers.yandexcloud.net/']) {
    assert.throws(() => readNutritionInspectionConfiguration({ ...ready, MIGRATION_URL: bad }), /runner root configuration missing/)
  }
  assert.throws(() => readNutritionInspectionConfiguration({ ...ready, SUPABASE_PROJECT_ID: '' }), /registry project configuration missing/)
  assert.throws(() => readNutritionInspectionConfiguration({ ...ready, YC_TOKEN: '' }), /IAM configuration missing/)
})
test('production-configured Android build uses only the same independent default-off nutrition frontend variables', () => {
  const workflow = readFileSync(new URL('../.github/workflows/android-build.yml', import.meta.url), 'utf8')
  assert.match(workflow, /VITE_NUTRITION_ENABLED: \$\{\{ vars\.VITE_NUTRITION_ENABLED \|\| 'false' \}\}/)
  assert.match(workflow, /VITE_NUTRITION_PILOT_USER_IDS: \$\{\{ vars\.VITE_NUTRITION_PILOT_USER_IDS \|\| '' \}\}/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/)
})
test('inspection requires exact distinct three-client/two-trainer owner-approved cohort without raw contacts in errors', () => {
  assert.deepEqual(readNutritionAccounts(JSON.stringify(accounts), digest(accounts)), accounts)
  assert.throws(() => readNutritionAccounts(JSON.stringify(accounts)), /Unapproved private cohort/)
  for (const changed of [accounts.slice(1), [...accounts.slice(1), accounts[1]],
    accounts.map(a => ({ ...a, role: 'client' })), accounts.map(a => ({ ...a, extra: true }))]) {
    assert.throws(() => readNutritionAccounts(JSON.stringify(changed), digest(changed)), /Invalid private cohort/)
  }
})
test('legacy registry matches exact email, not prefix/name, rejects missing, ambiguous and duplicate identities', () => {
  assert.equal(profiles.length, 5)
  assert.throws(() => resolveNutritionProfiles(accounts, users.slice(1)), /missing or not unique/)
  assert.throws(() => resolveNutritionProfiles(accounts, [...users, users[0]]), /missing or not unique/)
  assert.throws(() => resolveNutritionProfiles(accounts, users.map(u => ({ ...u, email: u.email.replace('@', '+other@') }))), /missing or not unique/)
  assert.throws(() => resolveNutritionProfiles(accounts, users.map(u => ({ ...u, id: users[0].id }))), /must be distinct/)
})
test('Yandex verification inspects each immutable profile and exports only role UUID lists, never emails or sessions', async () => {
  const calls = []
  const result = await verifyNutritionProfiles(profiles, async body => {
    calls.push(body)
    return { status: 'rollout_inspected', accountRole: profiles.find(p => p.profileId === body.profileId).role,
      domainReady: true, identityLinked: true, rolloutEnabled: true }
  })
  assert.deepEqual(calls, profiles.map(p => ({ action: 'inspect', profileId: p.profileId })))
  assert.equal(result.clientProfileIds.length, 3)
  assert.equal(result.trainerProfileIds.length, 2)
  assert.doesNotMatch(JSON.stringify(result), /email|session|token|synthetic|example/)
})
test('mismatched current role, missing domain/identity, disabled rollout and wrong response fail closed', async () => {
  const ready = { status: 'rollout_inspected', accountRole: 'client', domainReady: true, identityLinked: true, rolloutEnabled: true }
  for (const changed of [{ accountRole: 'trainer' }, { domainReady: false }, { identityLinked: false },
    { rolloutEnabled: false }, { status: 'rollout_enabled' }]) {
    await assert.rejects(verifyNutritionProfiles(profiles, async () => ({ ...ready, ...changed })), /not ready or role mismatched/)
  }
})
test('inspection workflow is main-only manual, private cohort/read-only registry and existing IAM inspect; no activation or impersonation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/inspect-nutrition-pilot.yml', import.meta.url), 'utf8')
  const source = readFileSync(new URL('./inspect-nutrition-pilot.mjs', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /secrets\.FIT_NUTRITION_ACCOUNT_COHORT/)
  assert.match(workflow, /retention-days: 1/)
  assert.doesNotMatch(workflow, /terraform apply|gh variable set|workflow_run|pull_request|profileId:/)
  assert.match(source, /action: 'inspect'/)
  assert.match(source, /page <= 20/)
  assert.match(source, /stage\/rollout-assignments\/yandex/)
  assert.match(source, /JSON\.stringify\(first\) !== JSON\.stringify\(second\)/)
  assert.doesNotMatch(source, /action: 'enable'|action: 'disable'|create.session|enroll|console\.(log|error)\((accounts|profiles|users|key|result)/)
})
