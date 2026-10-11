import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { nativeNutritionKey, prepareNativeNutritionCohort } from './prepare-nutrition-native-cohort.mjs'
import { readNutritionAccounts, resolveNutritionProfiles, verifyNutritionProfiles, readNutritionInspectionConfiguration,
  readNutritionRegistryMatches, summarizeNutritionRegistryMatches } from './inspect-nutrition-pilot.mjs'

const accounts = Array.from({ length: 5 }, (_, i) => ({ email: `synthetic-${i}@example.test`, role: i < 3 ? 'client' : 'trainer' }))
const digest = a => createHash('sha256').update(a.map(x => `${x.role}:${x.email}`).sort().join('\n')).digest('hex')
const users = accounts.map((a, i) => ({ email: a.email, id: `10000000-0000-4000-8000-00000000000${i}` }))
const profiles = resolveNutritionProfiles(accounts, users)
test('native cohort is derived only from the exact owner-approved private input, never registry or UUID guesses', () => {
  const result = JSON.parse(prepareNativeNutritionCohort(JSON.stringify(accounts), digest(accounts)))
  assert.equal(result.clients.length, 3)
  assert.equal(result.trainers.length, 2)
  assert.equal(new Set([...result.clients, ...result.trainers]).size, 5)
  assert.match(result.clients[0], /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(result), /email|example|synthetic|profile|subject/)
  assert.throws(() => prepareNativeNutritionCohort(JSON.stringify(accounts)), /Unapproved/)
  assert.equal(nativeNutritionKey('sample.name@yandex.ru'), nativeNutritionKey('sample-name'))
  assert.notEqual(nativeNutritionKey('sample.name@example.test'), nativeNutritionKey('sample-name@example.test'))
  assert.notEqual(nativeNutritionKey('sample@example.test'), nativeNutritionKey('sample'))
})
test('native release keeps trusted main, exact fingerprint, private server hashes and default-off public decisions', () => {
  const stage = readFileSync(new URL('../.github/workflows/deploy-yandex-stage.yml', import.meta.url), 'utf8')
  assert.equal(stage.split('run: node scripts/prepare-nutrition-native-cohort.mjs').length - 1, 2)
  const prepare = readFileSync(new URL('./prepare-nutrition-native-cohort.mjs', import.meta.url), 'utf8')
  assert.match(prepare, /GITHUB_REF !== 'refs\/heads\/main'/)
  assert.match(prepare, /GITHUB_REPOSITORY !== 'podkolzinpd\/fit'/)
  assert.doesNotMatch(prepare, /resolveNutritionProfiles|SUPABASE_ACCESS_TOKEN|nutrition-pilot-ids/)
  for (const workflow of ['deploy-yandex-frontend', 'android-build']) {
    const text = readFileSync(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8')
    assert.match(text, /VITE_NUTRITION_NATIVE_COHORT: \$\{\{ vars\.VITE_NUTRITION_NATIVE_COHORT \|\| 'false' \}\}/)
    assert.doesNotMatch(text, /FIT_NUTRITION_ACCOUNT_COHORT/)
  }
})
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
test('bounded registry inspection does not treat short provider-capped pages as complete or retain unrelated users', async () => {
  const pages = [[users[0], { email: 'unrelated@example.test', id: 'unrelated-private-id', metadata: 'private' }],
    users.slice(1, 3), users.slice(3), []]
  const calls = []
  const matched = await readNutritionRegistryMatches(accounts, async page => {
    calls.push(page)
    return { users: pages[page - 1] }
  })
  assert.deepEqual(calls, [1, 2, 3, 4])
  assert.deepEqual(matched, users)
  assert.doesNotMatch(JSON.stringify(matched), /unrelated|metadata|private/)
  assert.deepEqual(summarizeNutritionRegistryMatches(accounts, matched), { clients: 3, trainers: 2, missing: 0, ambiguous: 0, invalid: 0 })
})
test('registry inspection rejects nonterminal, malformed and oversized pages without relaxing the bound', async () => {
  let calls = 0
  await assert.rejects(readNutritionRegistryMatches(accounts, async () => { calls++; return { users: [users[0]] } }), /bounded scope/)
  assert.equal(calls, 20)
  for (const invalid of [{}, { users: null }, { users: Array(1001).fill(users[0]) }]) {
    await assert.rejects(readNutritionRegistryMatches(accounts, async () => invalid), /Invalid identity registry page/)
  }
})
test('unresolved cohort diagnostics contain only counts, never email, profile IDs or user records', () => {
  const matched = [users[0], users[0], { ...users[1], id: 'invalid-private-id' }, users[3]]
  const summary = summarizeNutritionRegistryMatches(accounts, matched)
  assert.deepEqual(summary, { clients: 0, trainers: 1, missing: 2, ambiguous: 1, invalid: 1 })
  assert.doesNotMatch(JSON.stringify(summary), /email|profile|[a-f0-9]{8}-|synthetic|example|private/)
  assert.throws(() => resolveNutritionProfiles(accounts, matched), /missing or not unique/)
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
