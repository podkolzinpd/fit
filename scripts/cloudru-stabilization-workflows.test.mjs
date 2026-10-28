import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { planMediaAclReadRepair } from './repair-cloudru-media-acl.mjs'
import { createHash } from 'node:crypto'
import { readHistoryTargets, readHistoryRegistry, readHistoryPages, summarizeHistory, inspectCurrentHistory,
  readHistoryEvidenceSecret, resolveHistoryEvidence, readHistoryVisibility,
  readWorkoutHistoryTarget, inspectWorkoutHistoryTarget } from './cloudru-account-history-audit.mjs'
import { probeRuntimeDatabase } from './cloudru-runtime-db-probe.mjs'

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const configurations = ['configure-cloudru-ai', 'configure-cloudru-background', 'configure-cloudru-speech', 'configure-cloudru-nutrition']

const historyFixtureIds = [1, 2, 3, 4, 5].map(n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
test('food search probe is manual, bounded and uses the running API without diary or secret export', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.split('- name: Probe public nutrition search in the running API')[1]?.split('- name:')[0]
  assert.ok(step)
  assert.match(step, /github.event_name == 'workflow_dispatch' && inputs\.nutrition_search/)
  assert.match(step, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step, /timeout 105 podman exec fit-api-stage node dist\/nutrition-search-probe\.js/)
  assert.doesNotMatch(step, /--env-file|printenv|DATABASE|--format.*Env|configure|\/v1\/nutrition\/entries/)
})
test('runtime connection probe only reads settings, rolls back and never calls an application function', async () => {
  const statements = []
  let ended = false
  const client = { connect: async () => {}, query: async sql => { statements.push(sql); return { rows: [{ valid: true }] } }, end: async () => { ended = true } }
  assert.deepEqual(await probeRuntimeDatabase(client), { event: 'cloudru_runtime_database_probe', ready: true })
  assert.equal(statements[0], 'begin read only')
  assert.equal(statements.at(-1), 'rollback')
  assert.ok(statements.includes("set local statement_timeout = '10s'"))
  assert.doesNotMatch(statements.join('\n'), /app_private|public\.|\b(?:insert|update|delete|commit|grant|alter)\b/i)
  assert.equal(ended, true)
})
test('runtime connection probe isolates invalid timeout settings without exposing server error text', async () => {
  const statements = []
  let ended = false
  const report = await probeRuntimeDatabase({ connect: async () => {}, query: async sql => {
    statements.push(sql)
    if (sql.startsWith('set local')) throw Object.assign(new Error('private-database-message'), { code: '22023', detail: 'private-detail' })
    return { rows: [] }
  }, end: async () => { ended = true } })
  assert.deepEqual(report, { event: 'cloudru_runtime_database_probe', ready: false, phase: 'timeout', code: '22023' })
  assert.equal(statements.at(-1), 'rollback')
  assert.equal(ended, true)
  assert.doesNotMatch(JSON.stringify(report), /private-/)
})
test('runtime probe is opt-in, main-only and never receives owner credentials or changes runtime', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.split('      - name: Probe only runtime database')[1].split('      - name:')[0]
  assert.match(step, /always\(\).*workflow_dispatch.*inputs\.runtime_database_probe/)
  assert.match(step, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step, /DATABASE_USER == "fit_api"/)
  assert.match(step, /--read-only --memory=128m --cpus=0.5 --timeout=20/)
  assert.match(step, /DATABASE_\(HOST\|PORT\|NAME\|USER\|PASSWORD\)/)
  assert.doesNotMatch(step, /MIGRATION_DATABASE|systemctl (?:start|restart|stop)|node dist\/cloudru-background-worker|tee.*api\.env/)
})
test('account history target hashes are secret-only and require the four distinct reviewed role slots', () => {
  const targets = ['trainerLegacy', 'trainerYandex', 'athleteLegacy', 'athleteYandex'].map(label => ({ label,
    role: label.startsWith('trainer') ? 'trainer' : 'client', emailHash: createHash('sha256').update(`fixture-${label}`).digest('hex') }))
  assert.deepEqual(readHistoryTargets(JSON.stringify(targets)), targets)
  for (const value of [targets.slice(1), [...targets.slice(0, 3), targets[0]], targets.map(target => ({ ...target, role: 'trainer' })),
    targets.map(target => ({ ...target, emailHash: 'not-a-hash' }))]) assert.throws(() => readHistoryTargets(JSON.stringify(value)), /targets_invalid/)
  assert.doesNotMatch(read('scripts/cloudru-account-history-audit.mjs'), /[a-f0-9]{64}/)
})
test('account history registry requires an empty terminal page and keeps only reviewed matches', async () => {
  const target = { label: 'athleteLegacy', role: 'client', emailHash: createHash('sha256').update('reviewed@example.test').digest('hex') }
  const pages = [[{ id: historyFixtureIds[0], email: ' Reviewed@Example.Test ', privateData: 'private-contact' }],
    [{ id: historyFixtureIds[1], email: 'unrelated@example.test' }], []]
  let calls = 0
  const result = await readHistoryRegistry(page => { calls++; return Promise.resolve({ users: pages[page - 1] }) }, [target])
  assert.equal(calls, 3)
  assert.deepEqual(result, [{ label: target.label, role: target.role, id: historyFixtureIds[0] }])
  assert.doesNotMatch(JSON.stringify(result), /@|private-contact|unrelated/)
  await assert.rejects(readHistoryRegistry(() => Promise.resolve({ users: pages[0] }), [target]), /registry_invalid/)
})

test('current history evidence accepts only private login/email/name hashes, never a raw ID or SQL', async () => {
  const hash = value => createHash('sha256').update(value).digest('hex')
  const secret = { idSha256: hash(historyFixtureIds[0]), messageSha256: hash('synthetic-support-marker') }
  assert.equal(readHistoryEvidenceSecret(undefined), null)
  assert.deepEqual(readHistoryEvidenceSecret(JSON.stringify(secret)), secret)
  for (const value of ['invalid', JSON.stringify({ ...secret, id: historyFixtureIds[0] }),
    JSON.stringify({ ...secret, idSha256: historyFixtureIds[0] }), 'null', '[]']) {
    assert.throws(() => readHistoryEvidenceSecret(value), /evidence_invalid/)
  }
  const queries = []
  const client = { query: async (text, values) => { queries.push({ text, values }); return { rows: [
    { kind: 'feedback', profile_id: historyFixtureIds[1], account_role: 'client', marker_matches: true },
  ] } } }
  assert.equal(await resolveHistoryEvidence(client, null), null)
  assert.equal(queries.length, 0)
  assert.deepEqual(await resolveHistoryEvidence(client, secret), { profileId: historyFixtureIds[1], kinds: ['feedback'] })
  assert.deepEqual(queries[0].values, [secret.idSha256, secret.messageSha256])
  assert.doesNotMatch(queries[0].text, /a0000000-|synthetic-support-marker|\b(?:insert|update|delete|grant|alter)\b/i)
  assert.match(queries[0].text, /limit 4/)
})

test('current evidence fails closed on an unrelated message, role, absent or ambiguous profile', async () => {
  const row = { kind: 'feedback', profile_id: historyFixtureIds[0], account_role: 'client', marker_matches: true }
  for (const [rows, error] of [[[], 'not_found'], [[{ ...row, marker_matches: false }], 'feedback_mismatch'],
    [[{ ...row, account_role: 'trainer' }], 'role_mismatch'], [[{ ...row, profile_id: null }], 'role_mismatch'],
    [[row, { ...row, profile_id: historyFixtureIds[1] }], 'ambiguous']]) {
    await assert.rejects(resolveHistoryEvidence({ query: async () => ({ rows }) }, {}), new RegExp(`evidence_${error}`))
  }
  assert.deepEqual(await resolveHistoryEvidence({ query: async () => ({ rows: [row, { ...row, kind: 'profile' }] }) }, {}),
    { profileId: row.profile_id, kinds: ['feedback', 'profile'] })
})

test('native athlete evidence extends only its verified profile and cards after the read-only gate', async () => {
  const [old, current, card, workout] = historyFixtureIds
  const sql = []
  const client = { query: async (text, values) => {
    sql.push({ text, values })
    return { rows: text.includes('current_setting') ? [{ readonly: 'on' }]
      : text.includes("select 'feedback'") ? [{ kind: 'profile', profile_id: current, account_role: 'client', marker_matches: true }]
      : text.includes('from public.profiles p') ? [{ id: old, account_role: 'client' }, { id: current, account_role: 'client', identity_linked: true, identity_origin: 'native' }]
      : text.includes('with recursive scope') ? [{ id: card, auth_user_id: current, trainer_id: current }]
      : text.includes('from public.workouts where') ? [{ id: workout, client_id: card, created_by: current, status: 'done', deleted_at: null }]
      : text.includes('from public.client_trainer_relationships') ? [{ client_id: card, trainer_id: old, status: 'disconnected', disconnected_at: 'private-date', disconnected_by: current }]
      : text.startsWith('select count') ? [{ count: 1 }] : [] }
  } }
  const runtime = { query: async text => ({ rows: text.includes('from pg_roles')
    ? [{ readonly: 'on', name: 'fit_api', rolsuper: false, rolbypassrls: false }]
    : text.startsWith('select count') ? [{ count: 1 }] : [] }) }
  const report = await inspectCurrentHistory(client, { profiles: [{ id: old, label: 'athleteLegacy', role: 'client' }], cards: [], workouts: [] }, { evidence: {}, runtimeClient: runtime })
  assert.equal(sql[0].text, 'begin transaction isolation level repeatable read read only')
  assert.deepEqual(sql.find(q => q.text.includes('with recursive scope')).values[0], [old, current])
  assert.deepEqual(report.currentEvidence, { sources: ['profile'], sameAsLegacyAthlete: false, currentProfileFound: true, identityLinked: true, identityOrigin: 'native' })
  assert.equal(report.currentWorkouts[0].author, 'athleteCurrent')
  assert.equal(report.relationships[0].disconnectedBy, 'athleteCurrent')
  assert.equal(report.visibility.find(row => row.account === 'athleteCurrent').readableWorkouts, 1)
  assert.ok(sql.every(query => !query.text.includes('set local role')))
  assert.doesNotMatch(JSON.stringify(report), /a0000000-|private-date/)
})

test('visibility uses a separate read-only non-privileged application connection and rolls back failed probes', async () => {
  for (const role of [
    { readonly: 'off', name: 'fit_api', rolsuper: false, rolbypassrls: false },
    { readonly: 'on', name: 'fit_owner', rolsuper: false, rolbypassrls: false },
    { readonly: 'on', name: 'fit_api', rolsuper: true, rolbypassrls: false },
    { readonly: 'on', name: 'fit_api', rolsuper: false, rolbypassrls: true },
  ]) {
    const sql = []
    await assert.rejects(readHistoryVisibility({ query: async text => { sql.push(text); return { rows: [role] } } }, historyFixtureIds[0], []), /runtime_role_invalid/)
    assert.equal(sql.at(-1), 'rollback')
    assert.ok(sql.every(text => !text.includes('from public.workouts')))
  }
  const sql = []
  const runtime = { query: async (text, values) => {
    sql.push({ text, values })
    return { rows: text.includes('from pg_roles') ? [{ readonly: 'on', name: 'fit_api', rolsuper: false, rolbypassrls: false }]
      : text.startsWith('select count') ? [{ count: 2 }] : [] }
  } }
  assert.equal(await readHistoryVisibility(runtime, historyFixtureIds[0], [historyFixtureIds[1]]), 2)
  assert.equal(sql.at(-1).text, 'commit')
  assert.ok(sql.every(q => !/set local role|\b(?:grant|insert|update|delete|alter)\b/i.test(q.text)))
  const failing = { query: async text => {
    if (text.startsWith('select count')) throw Object.assign(new Error('private-error'), { code: '42501' })
    return runtime.query(text)
  } }
  await assert.rejects(readHistoryVisibility(failing, historyFixtureIds[0], []), /private-error/)
  assert.equal(sql.at(-1).text, 'rollback')
})

test('account history source pagination handles provider caps and rejects duplicates and overflow', async () => {
  const offsets = []
  const rows = historyFixtureIds.slice(0, 2).map(id => ({ id }))
  assert.deepEqual(await readHistoryPages(offset => { offsets.push(offset); return Promise.resolve(rows.slice(offset, offset + 1)) }, 2), rows)
  assert.deepEqual(offsets, [0, 1, 2])
  await assert.rejects(readHistoryPages(() => Promise.resolve(rows), 1), /scope_exceeded/)
  await assert.rejects(readHistoryPages(() => Promise.resolve([rows[0]]), 2), /source_scope_invalid/)
})

test('account history summary distinguishes missing, soft deleted, inaccessible and unresolved native profiles without exporting IDs', () => {
  const [actor, card, first, second, third] = historyFixtureIds
  const workout = id => ({ id, client_id: card, created_by: actor, status: 'done', deleted_at: null, privateNotes: 'private-training' })
  const legacy = { profiles: [{ id: actor, label: 'athleteLegacy', role: 'client' }], cards: [], workouts: [workout(first), workout(second)] }
  const current = { profiles: [{ id: actor, account_role: 'client', identity_linked: true, identity_origin: 'linked' }],
    cards: [{ id: card, auth_user_id: actor, trainer_id: actor }],
    workouts: [{ ...workout(first), deleted_at: '2026-10-22' }, workout(third)], relationships: [], merges: [] }
  const report = summarizeHistory(legacy, current, [{ account: 'athleteLegacy', readableWorkouts: 1 }])
  assert.equal(report.legacyWorkoutIdsMissingNow, 1)
  assert.equal(report.legacyWorkoutsSoftDeletedNow, 1)
  assert.equal(report.profiles.find(profile => profile.account === 'athleteYandex').currentProfileFound, null)
  assert.equal(report.visibility[0].readableWorkouts, 1)
  assert.doesNotMatch(JSON.stringify(report), /private-training|a0000000-|@/)
})

test('account history current inspection fails before data reads unless transaction is read only', async () => {
  const sql = []
  const client = { query: text => { sql.push(text); return Promise.resolve({ rows: text.includes('current_setting') ? [{ readonly: 'off' }] : [] }) } }
  await assert.rejects(inspectCurrentHistory(client, { profiles: [], cards: [], workouts: [] }, { evidence: {} }), /readonly_required/)
  assert.equal(sql[0], 'begin transaction isolation level repeatable read read only')
  assert.equal(sql.at(-1), 'rollback')
  assert.ok(sql.every(text => !text.includes('from public.')))
})

test('account history inspection uses scoped read-only SQL and restores the actor probe after denied role switch', async () => {
  const sql = []
  const actor = historyFixtureIds[0]
  const client = { query: (text, values) => {
    sql.push({ text, values })
    if (text === 'set local role fit_api') return Promise.reject(Object.assign(new Error('private-role-detail'), { code: '42501' }))
    return Promise.resolve({ rows: text.includes('current_setting') ? [{ readonly: 'on' }]
      : text.includes('from public.profiles p') ? [{ id: actor, account_role: 'client' }] : [] })
  } }
  const report = await inspectCurrentHistory(client, { profiles: [{ id: actor, label: 'athleteLegacy', role: 'client' }], cards: [], workouts: [] })
  assert.deepEqual(report.visibility, [{ account: 'athleteLegacy', probeUnavailable: 'role_permission_denied' }])
  assert.ok(sql.some(query => query.text === 'rollback to savepoint visibility_probe'))
  assert.equal(sql.at(-1).text, 'commit')
  assert.ok(sql.every(query => !/\b(?:insert|update|delete|alter|grant|truncate)\b/i.test(query.text)))
  assert.doesNotMatch(JSON.stringify(report), /private-role-detail|a0000000-/)
})

test('account history operation is manual, main-only, fixed-scope and does not enable repairs or expose contacts', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.slice(workflow.indexOf('      - name: Inspect only the owner-approved account history'), workflow.indexOf('      - name: Verify certificate renewal'))
  assert.match(step, /github.event_name == 'workflow_dispatch' && \(\(always\(\) && inputs.workout_history_target\) \|\| \(success\(\) && inputs.account_history\)\)/)
  assert.match(step, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(step, /--read-only.*--timeout=120/)
  assert.match(step, /cloudru-account-history-audit\.mjs:\/inspection\.mjs:ro/)
  assert.match(step, /FIT_ACCOUNT_HISTORY_EVIDENCE: \$\{\{ secrets\.FIT_ACCOUNT_HISTORY_EVIDENCE \}\}/)
  assert.match(step, /\.DATABASE_USER == "fit_api"/)
  assert.match(step, /DATABASE_SSL_MODE=require/)
  assert.doesNotMatch(step, /api\.env|Config\.Env|--privileged/)
  assert.doesNotMatch(step, /ssh |psql|pg_restore|--privileged|workflow_dispatch.*email/)
  const script = read('scripts/cloudru-account-history-audit.mjs')
  assert.doesNotMatch(script, /@gmail|@yandex|@glitchy|method: '(?:POST|PUT|DELETE|PATCH)'/)
})

test('journal preflight accepts only private login/email/name hashes, never SQL, names or actor overrides', () => {
  const value = { trainerLoginSha256: 'a'.repeat(64), trainerEmailSha256: 'c'.repeat(64), clientNameSha256: 'b'.repeat(64) }
  assert.deepEqual(readWorkoutHistoryTarget(JSON.stringify(value)), value)
  for (const bad of [null, [], {}, { ...value, actor: historyFixtureIds[0] }, { ...value, clientNameSha256: 'private name' }]) {
    assert.throws(() => readWorkoutHistoryTarget(JSON.stringify(bad)), /target_invalid/)
  }
})

function journalClients({ readonly = true, candidates = [historyFixtureIds[0]], role = 'trainer', identityLinked = false, runtimeRole = 'fit_api', cards = [] } = {}) {
  const queries = []
  const owner = { query: async (text, values) => {
    queries.push({ actor: 'owner', text, values })
    return { rows: text.includes('current_setting') ? [{ readonly: readonly ? 'on' : 'off' }]
      : text.includes('select distinct profile_id') ? candidates.map(profile_id => ({ profile_id }))
      : text.includes('select account_role') ? [{ account_role: role, yandex_linked: identityLinked }] : [] }
  } }
  const runtime = { query: async (text, values) => {
    queries.push({ actor: 'runtime', text, values })
    return { rows: text.includes('from pg_roles') ? [{ readonly: 'on', name: runtimeRole, rolsuper: false, rolbypassrls: false }]
      : text.includes('from public.clients c') ? cards
      : text.includes('from public.workouts') ? [{ status: 'done', deleted: false, count: 2 }] : [] }
  } }
  return { owner, runtime, queries }
}
const journalTarget = { trainerLoginSha256: 'a'.repeat(64), trainerEmailSha256: 'c'.repeat(64), clientNameSha256: 'b'.repeat(64) }

test('journal preflight refuses writable owner and conflicting trainer identities before client reads', async () => {
  for (const [settings, legacy, code] of [
    [{ readonly: false }, null, /readonly_required/],
    [{ candidates: [historyFixtureIds[0], historyFixtureIds[1]] }, null, /trainer_ambiguous/],
    [{}, historyFixtureIds[1], /trainer_ambiguous/],
    [{ role: 'client' }, null, /trainer_role_invalid/],
    [{ runtimeRole: 'fit_owner' }, null, /runtime_role_invalid/],
  ]) {
    const f = journalClients(settings)
    await assert.rejects(inspectWorkoutHistoryTarget(f.owner, f.runtime, journalTarget, legacy), code)
    assert.ok(!f.queries.some(q => q.text.includes('from public.clients')))
    assert.equal(f.queries.at(-1).text, 'rollback')
  }
})

test('journal preflight reads scoped counts through the real runtime role without exporting private IDs', async () => {
  const f = journalClients({ cards: [{ id: historyFixtureIds[2], auth_user_id: historyFixtureIds[3], archived: false, merged: false }] })
  const result = await inspectWorkoutHistoryTarget(f.owner, f.runtime, journalTarget)
  assert.deepEqual(f.queries.find(q => q.text.includes('select distinct profile_id')).values, [['a'.repeat(64), 'c'.repeat(64)]])
  assert.deepEqual(result, { event: 'workout_history_import_preflight', readOnly: true, trainerMatched: true, retainedLoginBinding: true, yandexIdentityLinked: false,
    matchingCards: 1, activeMatchingCards: 1, athleteLinked: true, existingWorkouts: [{ status: 'done', deleted: false, count: 2 }] })
  assert.doesNotMatch(JSON.stringify(result), /a0000000|private name|[ab]{64}/)
  assert.ok(f.queries.every(q => !/\b(?:insert|update|delete|alter|grant|truncate)\b/i.test(q.text)))
  assert.ok(f.queries.some(q => q.actor === 'runtime' && q.text.includes('request.jwt.claim.sub') && q.values[0] === historyFixtureIds[0]))
  assert.ok(f.queries.some(q => q.actor === 'runtime' && q.text.includes('relationship.client_id=c.id') && q.text.includes("relationship.status='active'")))
})

test('journal preflight preserves ambiguity and never chooses one of two active matching cards', async () => {
  const f = journalClients({ cards: [2, 3].map(n => ({ id: historyFixtureIds[n], archived: false, merged: false })) })
  const result = await inspectWorkoutHistoryTarget(f.owner, f.runtime, journalTarget)
  assert.equal(result.activeMatchingCards, 2)
  assert.deepEqual(result.existingWorkouts, [])
  assert.ok(!f.queries.some(q => q.text.includes('from public.workouts')))
})

test('journal preflight reports a missing trainer without broadening to other trainers', async () => {
  const f = journalClients({ candidates: [] })
  assert.equal((await inspectWorkoutHistoryTarget(f.owner, f.runtime, journalTarget)).trainerMatched, false)
  assert.ok(f.queries.every(q => q.actor === 'owner'))
})

test('journal preflight secret is isolated from the earlier history repair and cannot trigger both modes', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  assert.match(workflow, /FIT_WORKOUT_HISTORY_TARGET: \$\{\{ inputs.workout_history_target && secrets.FIT_WORKOUT_HISTORY_TARGET \|\| '' \}\}/)
  assert.match(workflow, /test "\$ACCOUNT_HISTORY_MODE" != true/)
  assert.match(workflow, /names\+=\(FIT_WORKOUT_HISTORY_TARGET\)/)
  assert.match(workflow, /test "\$WORKOUT_HISTORY_TARGET_MODE" != true && test -n "\$FIT_ACCOUNT_HISTORY_EVIDENCE"/)
})

test('journal read-only diagnostics run after monitor failure without hiding it or changing the earlier history gate', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.split('      - name: Inspect only the owner-approved account history')[1]?.split('      - name:')[0]
  const condition = step.match(/\n        if: (.+)\n/)[1]
  // Evaluate the actual trusted workflow expression under the status cases.
  const enabled = new Function('github', 'inputs', 'always', 'success', `return Boolean(${condition})`)
  for (const healthy of [true, false]) {
    assert.equal(enabled({ event_name: 'workflow_dispatch' }, { workout_history_target: true }, () => true, () => healthy), true)
    assert.equal(enabled({ event_name: 'workflow_dispatch' }, { account_history: true }, () => true, () => healthy), healthy)
    assert.equal(enabled({ event_name: 'workflow_dispatch' }, {}, () => true, () => healthy), false)
    assert.equal(enabled({ event_name: 'schedule' }, { workout_history_target: true }, () => true, () => healthy), false)
  }
  assert.doesNotMatch(step, /continue-on-error/)
  const monitor = workflow.split('      - name: Inspect runtime, workers, certificates and backup freshness')[1].split('      - name:')[0]
  assert.match(monitor, /exit "\$failed"/)
  assert.doesNotMatch(monitor, /continue-on-error/)
})

for (const name of configurations) {
  test(`${name} requires green exact-main, a trusted host and the shared VM lock`, () => {
    const workflow = read(`.github/workflows/${name}.yml`)
    assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
    assert.match(workflow, /test "\$commit" = "\$GITHUB_SHA"/)
    assert.match(workflow, /\.conclusion == "success"/)
    assert.match(workflow, /\.head_repository.full_name == \$repo/)
    assert.match(workflow, /\.path == "\.github\/workflows\/ci.yml"/)
    // Production runner has curl/jq, but no GitHub CLI. Keep the source guard executable there.
    assert.doesNotMatch(workflow, /\bgh api\b/)
    assert.match(workflow, /curl --fail --silent --show-error --max-time 15/)
    assert.match(workflow, /Authorization: Bearer \$GH_TOKEN/)
    assert.match(workflow, /github_api commits\/main \| jq -er \.sha/)
    assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
    assert.match(workflow, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
    assert.doesNotMatch(workflow, /\n  (push|pull_request|schedule):|add-access-binding|terraform apply|system:allUsers/)
  })
}

test('all new operational shell steps parse without performing any infrastructure operations', () => {
  for (const name of [...configurations, 'backup-cloudru-production', 'inspect-cloudru-operations', 'maintain-cloudru-runner-disk', 'route-legacy-yandex-to-cloudru', 'repair-cloudru-media-acl']) {
    const workflow = read(`.github/workflows/${name}.yml`)
    for (const match of workflow.matchAll(/\n        run: \|\n([\s\S]*?)(?=\n      - |$)/g)) {
      const result = spawnSync('bash', ['-n'], { input: match[1].replace(/^          /gm, ''), encoding: 'utf8' })
      assert.equal(result.status, 0, `${name}: ${result.stderr}`)
    }
  }
  for (const path of ['scripts/promote-cloudru-speech.sh', 'infra/cloudru/fit-cloudru-background', 'infra/cloudru/fit-cloudru-speechkit']) {
    assert.equal(spawnSync('bash', ['-n'], { input: read(path), encoding: 'utf8' }).status, 0, path)
  }
})

test('root expansion is manual, VM-bound and constrained to the known ext4 root partition', () => {
  const workflow = read('.github/workflows/maintain-cloudru-runner-disk.yml')
  assert.match(workflow, /options: \[inspect, inspect-root, extend-root, apply\]/)
  assert.match(workflow, /RETENTION_CONFIRMATION" = EXPAND_CLOUDRU_ROOT_FILESYSTEM/)
  assert.match(workflow, /test "\$root_source" = \/dev\/vda2/)
  assert.match(workflow, /test "\$root_fstype" = ext4/)
  assert.match(workflow, /test "\$disk_bytes" -ge 60000000000/)
  assert.match(workflow, /test "\$partition_bytes" -lt "\$disk_bytes"/)
  assert.match(workflow, /sudo growpart \/dev\/vda 2/)
  assert.match(workflow, /sudo resize2fs \/dev\/vda2/)
  assert.match(workflow, /test "\$expanded_kib" -ge 58593750/)
  assert.match(workflow, /Root filesystem inspection complete; nothing was changed/)
})

const mediaApp = 'b87cd7c3-c737-4cd7-87b3-6591dd9b3ec9'
const mediaAcl = () => ({ Owner: { ID: 'fixture-owner' }, Grants: [
  { Grantee: { Type: 'CanonicalUser', ID: 'fixture-owner' }, Permission: 'FULL_CONTROL' },
  { Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: 'READ' },
  { Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: 'WRITE' },
] })

test('media ACL repair preserves owner and app data grants and adds only READ_ACP', () => {
  const acl = mediaAcl()
  const before = structuredClone(acl)
  assert.deepEqual(planMediaAclReadRepair(acl), { changed: true, headers: {
    GrantRead: `id="${mediaApp}"`, GrantWrite: `id="${mediaApp}"`,
    GrantReadACP: `id="${mediaApp}"`, GrantFullControl: 'id="fixture-owner"',
  } })
  assert.deepEqual(acl, before)
})

test('media ACL repair is idempotent when app already has ACL read or full control', () => {
  for (const permission of ['READ_ACP', 'FULL_CONTROL']) {
    const acl = mediaAcl()
    acl.Grants.push({ Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: permission })
    assert.equal(planMediaAclReadRepair(acl).changed, false)
  }
})

test('media ACL repair rejects public, unknown or malformed grants before mutation', () => {
  for (const grant of [
    { Grantee: { Type: 'Group', URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' },
    { Grantee: { Type: 'CanonicalUser', ID: 'unexpected-account' }, Permission: 'READ' },
    { Grantee: { Type: 'CanonicalUser', ID: mediaApp }, Permission: 'UNKNOWN' },
  ]) {
    const acl = mediaAcl()
    acl.Grants.push(grant)
    assert.throws(() => planMediaAclReadRepair(acl), /media_acl_requires_review/)
  }
  assert.throws(() => planMediaAclReadRepair({}), /media_acl_invalid/)
})

test('media ACL repair is manual, bucket-bound and uses only existing media credentials', () => {
  const workflow = read('.github/workflows/repair-cloudru-media-acl.yml')
  assert.match(workflow, /GRANT_APP_MEDIA_ACL_READ_ONLY/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(workflow, /group: cloudru-stage-vm\n  cancel-in-progress: false/)
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]),
    ['CLOUDRU_MEDIA_MIGRATION_KEY_ID', 'CLOUDRU_MEDIA_MIGRATION_KEY_SECRET'])
  const command = read('scripts/repair-cloudru-media-acl.mjs')
  assert.match(command, /const bucket = 'fit-cloudru-stage-media-c2ad3760'/)
  assert.doesNotMatch(command, /PutBucketPolicyCommand|PutBucketOwnershipControlsCommand|CreateAccessKey|DATABASE_/)
  assert.doesNotMatch(workflow, /schedule:|push:|pull_request:|add-access-binding/)
})

test('legacy routing is manually confirmed and never changes database or IAM resources', () => {
  const workflow = read('.github/workflows/route-legacy-yandex-to-cloudru.yml')
  assert.match(workflow, /group: yandex-stage/)
  assert.match(workflow, /ROUTE_OLD_ADDRESSES_TO_CLOUDRU/)
  assert.match(workflow, /test "\$commit" = "\$GITHUB_SHA"/)
  assert.doesNotMatch(workflow, /\n  (push|schedule):|terraform apply|add-access-binding|DATABASE_PASSWORD|SUPABASE_/)
})

test('offsite restore cannot connect to production or expose a database port and never publishes dumps', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const restore = workflow.slice(workflow.indexOf('      - name: Restore downloaded backup'), workflow.indexOf('      - name: Verify private media after'))
  assert.match(restore, /--network=none/)
  assert.match(restore, /POSTGRES_DB=fit_restore/)
  assert.match(restore, /pg_isready -h 127\.0\.0\.1 -U fit_owner -d fit_restore/)
  assert.match(restore, /--dbname fit_restore/)
  assert.match(restore, /has_table_privilege\('fit_api'/)
  assert.match(restore, /c.relrowsecurity/)
  assert.match(restore, /create role fit_api nologin; create role fit_datalens nologin;/)
  assert.doesNotMatch(restore, /--no-acl/)
  assert.doesNotMatch(restore, /--publish|--network=host|10\.70\.10\.67|DATABASE_PASSWORD/)
  assert.match(workflow, /sudo rm -f --/)
  assert.doesNotMatch(workflow, /upload-artifact|rm -rf|volume prune|--dbname fit(?:\s|$)/)
  assert.match(workflow, /CLOUDRU_BACKUP_ENCRYPTION_KEY/)
  assert.match(workflow, /CLOUDRU_BACKUP_KEY_ID: \$\{\{ secrets\.CLOUDRU_BACKUP_KEY_ID \}\}/)
  assert.match(workflow, /CLOUDRU_BACKUP_KEY_SECRET: \$\{\{ secrets\.CLOUDRU_BACKUP_KEY_SECRET \}\}/)
  const backupRun = workflow.slice(workflow.indexOf('      - name: Back up only'), workflow.indexOf('      - name: Restore downloaded'))
  assert.match(backupRun, /for name in CLOUDRU_BACKUP_KEY_ID CLOUDRU_BACKUP_KEY_SECRET CLOUDRU_BACKUP_ACCOUNT_ID CLOUDRU_BACKUP_ENCRYPTION_KEY BACKUP_MODE/)
  assert.match(backupRun, /for name in CLOUDRU_MEDIA_KEY_ID CLOUDRU_MEDIA_KEY_SECRET BACKUP_MODE/)
  assert.match(backupRun, /--env-file "\$private_env"[^\n]*\n[^\n]*\n[^\n]*cloudru-backup\.js/)
  const mediaRun = workflow.slice(workflow.indexOf('      - name: Verify private media after'), workflow.indexOf('      - name: Remove only'))
  assert.match(mediaRun, /--env-file "\$media_env"[^\n]*\n[^\n]*cloudru-media-health\.js/)
  assert.doesNotMatch(backupRun, /cloudru-media-health\.js/)
  assert.doesNotMatch(restore, /cloudru-media-health\.js|continue-on-error/)
  assert.ok(workflow.indexOf('date -u +%Y-%m-%dT%H:%M:%SZ') < workflow.indexOf('      - name: Verify private media after'))
  assert.doesNotMatch(mediaRun, /continue-on-error|--env-file "\$private_env"/)
  assert.doesNotMatch(read('services/api/src/cloudru-backup.ts'), /PutBucketAclCommand|PutBucketPolicyCommand/)
  assert.match(workflow, /"\/opt\/fit\/secrets\/media-health-\$id\.env"/)
  for (const runtime of ['start-cloudru-api-stage', 'release-cloudru-api-stage']) {
    assert.doesNotMatch(read(`.github/workflows/${runtime}.yml`), /CLOUDRU_BACKUP_KEY_(?:ID|SECRET)/)
  }
})

test('restore table inventory excludes ACL, table data and partition attachment entries', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const program = workflow.match(/\| awk '(\$4 == "TABLE"[^']+)'/)[1]
  const inventory = [
    '1; 1259 123 TABLE public workouts fit_owner',
    '2; 1259 124 TABLE app_private fit_migrations fit_owner',
    '3; 0 123 TABLE DATA public workouts fit_owner',
    '4; 0 0 ACL public TABLE workouts fit_owner',
    '5; 0 0 COMMENT public TABLE workouts fit_owner',
    '6; 0 0 TABLE ATTACH public workouts_partition fit_owner',
  ].join('\n')
  const result = spawnSync('awk', [program], { input: inventory, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '2')
})

test('disposable restore image includes the production audit extension without importing secrets', () => {
  const image = read('infra/cloudru/backup-restore.Dockerfile')
  assert.match(image, /postgres:17@sha256:[a-f0-9]{64}/)
  assert.match(image, /postgresql-17-pgaudit=17\.1-2\.pgdg13\+1/)
  assert.match(image, /shared_preload_libraries=pg_stat_statements,pgaudit/)
  assert.match(image, /pgaudit\.log=none/)
  assert.match(image, /log_min_messages=panic/)
  assert.match(image, /log_min_error_statement=panic/)
  assert.doesNotMatch(image, /^(COPY|ADD|ARG|ENV)\b/m)
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  assert.match(workflow, /image="localhost\/fit-backup-restore:\$GITHUB_SHA"/)
  assert.match(workflow, /-f infra\/cloudru\/backup-restore\.Dockerfile infra\/cloudru/)
})

test('operations monitor expects speech only when its canonical endpoint is configured', () => {
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  assert.match(workflow, /SPEECH_EXPECTED_URL: \$\{\{ vars\.CLOUDRU_SPEECHKIT_RELAY_URL \}\}/)
  const check = workflow.match(/          if test -n "\$SPEECH_EXPECTED_URL";[\s\S]*?\n          fi/)[0]
  for (const [url, expected] of [['', 0], ['wss://api.fit-training.ru/stt', 0], ['wss://invalid.example/stt', 1]]) {
    const script = `failed=0
check() {
  shift
  if test "$1" = test; then "$@" || failed=1; fi
}
${check}
exit "$failed"
`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8',
      env: { ...process.env, SPEECH_EXPECTED_URL: url, GITHUB_STEP_SUMMARY: '/dev/null' } })
    assert.equal(result.status, expected, result.stderr)
    assert.equal(result.stdout.includes('Speech relay disabled'), url === '')
  }
})

test('restore extension diagnostics expose only allowlisted system names', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const program = workflow.match(/\| awk '(\$4 == "EXTENSION"[^']+)'/)[1]
  const result = spawnSync('awk', [program], { encoding: 'utf8', input: [
    '1; 3079 123 EXTENSION - pg_stat_statements',
    '2; 3079 124 EXTENSION - synthetic-sensitive-name',
    '3; 0 0 COMMENT - EXTENSION pg_stat_statements',
  ].join('\n') })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'cloudru_restore_extension=pg_stat_statements\ncloudru_restore_extension=unrecognized\n')
})

test('restore diagnostics emit only fixed categories, never private stderr', () => {
  const workflow = read('.github/workflows/backup-cloudru-production.yml')
  const classifier = workflow.match(/sudo podman exec --user 0 "\$container" (sh -c '[\s\S]*?')\n            exit 1/)[1]
  const directory = mkdtempSync(join(tmpdir(), 'fit-restore-diagnostics-'))
  try {
    const errorFile = join(directory, 'restore-error')
    for (const [error, category] of [
      ['role "fit_datalens" does not exist', 'missing_role'],
      ['permission denied for relation example', 'permission_denied'],
      ['extension example is not available', 'missing_extension'],
      ['COPY failed: synthetic-sensitive-row', 'unclassified'],
    ]) {
      writeFileSync(errorFile, `${error}\nsynthetic-sensitive-row\n`)
      const result = spawnSync('bash', ['-c', classifier.replaceAll('/tmp/restore-error', errorFile)], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), `cloudru_restore_failed=${category}`)
      assert.equal(result.stderr, '')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('background delivery boundary is persistent and existing uncertain recovery receipts are not retried', () => {
  const workflow = read('.github/workflows/configure-cloudru-background.yml')
  assert.match(workflow, /test -f \/opt\/fit\/BACKGROUND_STARTED_AT/)
  assert.match(workflow, /START_CLOUDRU_FRESH_PUSH_ONLY/)
  assert.ok(workflow.indexOf('Preserve historical outbox') < workflow.indexOf('Install the private worker'))
  const worker = read('infra/cloudru/fit-cloudru-background')
  assert.match(worker, /flock -n 9/)
  assert.doesNotMatch(worker, /--publish|fit_owner|MIGRATION_DATABASE/)
})

test('speech ingress upgrades only the authenticated loopback relay and its runtime has no database credentials', () => {
  const configure = read('.github/workflows/configure-cloudru-speech.yml')
  assert.match(configure, /SPEECHKIT_API_KEY: \$\{\{ secrets\.CLOUDRU_SPEECHKIT_API_KEY \}\}/)
  assert.match(configure, /SPEECHKIT_FOLDER_ID: \$\{\{ vars\.CLOUDRU_SPEECHKIT_FOLDER_ID \}\}/)
  assert.match(configure, /test -n "\$SPEECHKIT_API_KEY"/)
  assert.match(configure, /\[\[ "\$SPEECHKIT_FOLDER_ID" =~ \^\[a-z0-9\]\{20\}\$ \]\]/)
  assert.doesNotMatch(configure, /sudo awk|YANDEX_CLOUD_MODEL_ID/)
  const workflow = read('.github/workflows/configure-cloudru-speech.yml')
  assert.match(workflow, /cloudru-smoke.mjs upstream/)
  assert.match(workflow, /cloudru-smoke.mjs guard/)
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]), ['CLOUDRU_SPEECHKIT_API_KEY'])
  assert.doesNotMatch(workflow, /MIGRATION_DATABASE_|DATABASE_PASSWORD/)
  const inspect = read('.github/workflows/inspect-cloudru-operations.yml')
  const diagnostics = inspect.slice(inspect.indexOf('      - name: Read only aggregate SpeechKit'), inspect.indexOf('      - name: Inspect runtime'))
  assert.match(diagnostics, /inputs\.speech_diagnostics/)
  assert.match(diagnostics, /journalctl CONTAINER_NAME=fit-speechkit-cloudru/)
  assert.doesNotMatch(diagnostics, /--unit=fit-speechkit\.service/)
  const validationStart = workflow.indexOf('          test -n "$SPEECHKIT_API_KEY"')
  const validation = workflow.slice(validationStart, workflow.indexOf('          id=', validationStart)).replace(/^          /gm, '')
  // Independent validation failures, not a browser/theme matrix: nothing after
  // this prefix (files, containers, upstream calls) is executed by this test.
  for (const [key, folder, expected] of [
    ['synthetic-speech-key', 'b1goqho12tlk9dibc3f3', 0],
    ['', 'b1goqho12tlk9dibc3f3', 1],
    ['synthetic-speech-key', 'invalid-folder', 1],
    ['synthetic\nspeech-key', 'b1goqho12tlk9dibc3f3', 1],
    ['synthetic\u0007speech-key', 'b1goqho12tlk9dibc3f3', 1],
  ]) {
    const result = spawnSync('bash', ['-eu', '-c', validation], {
      env: { SPEECHKIT_API_KEY: key, SPEECHKIT_FOLDER_ID: folder }, encoding: 'utf8',
    })
    assert.equal(result.status === 0, expected === 0)
  }
  const nginx = read('infra/cloudru/nginx-public-api.conf')
  assert.match(nginx, /location = \/stt/)
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:18084\/stt/)
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/)
})


test('background journal report keeps only fixed flags and allowlisted database codes', () => {
  const messages = [
    { event: 'cloudru_background_failed', errorCode: '42501', message: 'private-query-values' },
    { event: 'database_pool_window', databaseErrorCode: 'private-code' },
    { event: 'yandex_session_cleanup_failed', errorCode: 'ETIMEDOUT' },
  ].map(entry => JSON.stringify({ MESSAGE: JSON.stringify(entry) }))
  messages.push(JSON.stringify({ MESSAGE: 'cloudru_background_failed' }),
    JSON.stringify({ MESSAGE: 'private-credential-value' }),
    JSON.stringify({ MESSAGE: 'background_launcher_failed:container:125' }),
    JSON.stringify({ MESSAGE: 'background_launcher_failed:private-data:125' }), 'invalid-json', '[]', 'null')
  const result = spawnSync('python3', ['scripts/cloudru-background-diagnostics.py'], {
    input: messages.join('\n'), encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.workerFailed, true)
  assert.equal(report.sessionCleanupFailed, true)
  assert.deepEqual(report.databaseCodes, ['42501', 'ETIMEDOUT'])
  assert.deepEqual(report.launcherFailures, [{ stage: 'container', exitCode: 125 }])
  assert.doesNotMatch(result.stdout, /private-/)
})

test('background journal distinguishes transaction limits from work and keeps only bounded dispatch stages', () => {
  const messages = [
    { event: 'background_transaction_failed', transactionPhase: 'timeout', errorCode: '22023', message: 'private-sql' },
    { event: 'background_transaction_failed', transactionPhase: 'private-phase', errorCode: '22023' },
    { event: 'cloudru_background_failed', dispatchOperation: 'push', dispatchPhase: 'prepare', errorCode: '22023' },
    { event: 'yandex_session_cleanup_failed', dispatchOperation: 'auth_sessions', dispatchPhase: 'cleanup', errorCode: '22023' },
    { event: 'cloudru_background_failed', dispatchOperation: 'private-op', dispatchPhase: 'prepare', errorCode: 'private-code' },
  ].map(entry => JSON.stringify({ MESSAGE: JSON.stringify(entry) }))
  const result = spawnSync('python3', ['scripts/cloudru-background-diagnostics.py'], { input: messages.join('\n'), encoding: 'utf8' })
  assert.equal(result.status, 0)
  const report = JSON.parse(result.stdout)
  assert.deepEqual(report.transactionFailures, [{ phase: 'timeout', code: '22023' }])
  assert.deepEqual(report.dispatchFailures, [
    { operation: 'push', phase: 'prepare', code: '22023' }, { operation: 'auth_sessions', phase: 'cleanup', code: '22023' },
  ])
  assert.doesNotMatch(result.stdout, /private-/)
})

test('request diagnostics expose allowlisted auth stage and provider status only for the selected request', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const entry = { reqId: id, event: 'yandex_auth_failed', authStage: 'oauth_code', authFailure: 'provider_unavailable',
    errorCode: 'unknown', providerFailure: 'http', providerStatus: 502, token: 'private-token', err: { message: 'private-error' } }
  const lines = [entry, { ...entry, reqId: 'another-request' }, { ...entry, authStage: 'private-stage' },
    { ...entry, authFailure: 'private-failure' }, { ...entry, authStage: 'session_issue', errorCode: '22023', providerFailure: 'private-reason', providerStatus: 'private-status' }]
    .map(row => JSON.stringify({ CONTAINER_NAME: 'fit-api-stage', MESSAGE: JSON.stringify(row) }))
  const result = spawnSync('python3', ['scripts/cloudru-api-request-diagnostics.py', id], { input: lines.join('\n'), encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout).authFailures, [
    { stage: 'oauth_code', reason: 'provider_unavailable', code: 'unknown', providerFailure: 'http', providerStatus: 502 },
    { stage: 'session_issue', reason: 'provider_unavailable', code: '22023' },
  ])
  assert.doesNotMatch(result.stdout, /private-|another-request/)
})

test('manual API journal inspection exposes counts only, never user payloads or arbitrary codes', () => {
  const entry = (value, container = 'fit-api-stage') => JSON.stringify({
    CONTAINER_NAME: container, MESSAGE: JSON.stringify(value), PRIVATE_TOKEN: 'private-token',
  })
  const messages = [
    entry({ msg: 'Pilot command failed', databaseErrorCode: '23502', body: 'private-workout' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: '23502', email: 'private-email' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: 'PT422' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: 'private-code' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: 'TOKEN' }),
    entry({ msg: 'Pilot command failed', databaseErrorCode: '42702' }, 'another-container'),
    entry({ msg: 'private-message', databaseErrorCode: '42702' }),
    JSON.stringify({ CONTAINER_NAME: 'fit-api-stage', MESSAGE: 'private-raw-text' }),
    'invalid-json', '[]', 'null',
  ]
  const result = spawnSync('python3', ['scripts/cloudru-api-command-diagnostics.py'], {
    input: messages.join('\n'), encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), {
    event: 'cloudru_api_command_error_counts', journalEntries: 7, parsedApiEntries: 6,
    failedCommands: 5, databaseCodes: { '23502': 2, PT422: 1, unknown: 2 },
  })
  assert.doesNotMatch(result.stdout, /private-|42702|another-container|TOKEN/)
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.slice(workflow.indexOf('      - name: Read only bounded API'), workflow.indexOf('      - name: Inspect runtime'))
  assert.match(step, /github\.event_name == 'workflow_dispatch' && inputs\.api_errors/)
  assert.match(step, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step, /test "\$\(hostname\)" = fit-stage-app/)
  assert.match(step, /timeout 15 journalctl CONTAINER_NAME=fit-api-stage --since="24 hours ago" --lines=5000/)
  assert.match(step, /python3 scripts\/cloudru-api-command-diagnostics\.py \| tee/)
  assert.doesNotMatch(step, /secrets\.|--env-file|podman run|systemctl (?:restart|stop)|psql/)
})


test('request diagnostics correlate only the requested UUID and never export error messages or request data', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const row = (entry) => JSON.stringify({CONTAINER_NAME:'fit-api-stage',MESSAGE:JSON.stringify(entry)})
  const lines = [row({reqId:id,req:{body:'private-body'},msg:'private-msg'}),
    row({reqId:id,err:{type:'TypeError',code:'FST_ERR_FAILED_ERROR_SERIALIZATION',message:'private-sql',stack:'private-sql\n at x (/app/dist/planned-workout-request.js:120:3)'}}),
    row({reqId:id,res:{statusCode:500}}),row({reqId:'another',err:{type:'RangeError'}}),
    row({reqId:id,err:{type:'private-type',code:'private-code',stack:'private-stack'}}),
    row({reqId:id,planSaveStep:'stage',planSaveReason:'forbidden',body:'private-body'}),
    row({reqId:id,planSaveStep:'private-step',planSaveReason:'private-reason'}), 'null', 'invalid']
  const result = spawnSync('python3',['scripts/cloudru-api-request-diagnostics.py',id],{input:lines.join('\n'),encoding:'utf8'})
  assert.equal(result.status,0)
  const report = JSON.parse(result.stdout)
  assert.equal(report.matchedEntries,6)
  assert.deepEqual(report.planSaveFailures,[{step:'stage',reason:'forbidden'}])
  assert.deepEqual(report.statuses,[500])
  assert.deepEqual(report.errors,[{type:'TypeError',code:'FST_ERR_FAILED_ERROR_SERIALIZATION',frames:['planned-workout-request.js:120:3']},{type:'unknown',code:'unknown',frames:[]}])
  assert.doesNotMatch(result.stdout,/private-|another|reqId|body|message|stack/)
  const invalid = spawnSync('python3',['scripts/cloudru-api-request-diagnostics.py','not-a-uuid'],{input:lines.join('\n'),encoding:'utf8'})
  assert.notEqual(invalid.status,0)
  assert.equal(invalid.stdout,'')
  const workflow = read('.github/workflows/inspect-cloudru-operations.yml')
  const step = workflow.slice(workflow.indexOf('      - name: Read only bounded diagnostics for one API request'),workflow.indexOf('      - name: Read only aggregate SpeechKit'))
  assert.match(step,/github\.event_name == 'workflow_dispatch'/)
  assert.match(step,/test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(step,/test "\$\(hostname\)" = fit-stage-app/)
  assert.match(step,/timeout 15 journalctl CONTAINER_NAME=fit-api-stage/)
  assert.match(step,/--lines=5000/)
  assert.match(step,/epoch - 120/)
  assert.match(step,/epoch \+ 120/)
  assert.doesNotMatch(step,/secrets\.|--env-file|podman run|systemctl (?:restart|stop)|psql/)
})


test('both public workout API proxies stream request bodies without a temp-file dependency', () => {
  for (const target of ['web','api']) {
    const source=read(`infra/cloudru/nginx-public-${target}.conf`)
    const locations=[...source.matchAll(/    location [^\n]+\{\n[\s\S]*?\n    }/g)].map(match=>match[0])
    const api=locations.find(location=>location.includes('proxy_pass http://127.0.0.1:18080'))
    assert.ok(api)
    assert.match(api,/proxy_request_buffering off;/)
    assert.match(api,/proxy_http_version 1\.1;/)
    assert.match(source,/client_max_body_size 50m;/)
    assert.match(api,/proxy_set_header Host \$host;/)
    assert.doesNotMatch(api,/proxy_set_header (?:Authorization|X-Fit-Session)|proxy_pass_request_body off/)
  }
})

// Legacy email existence alone is insufficient to create a card in a current account.
test('journal preflight distinguishes a retained login binding from legacy-only identity and linked login', async () => {
  for (const [candidates, identityLinked] of [[[], false], [[], true], [[historyFixtureIds[0]], true]]) {
    const f = journalClients({ candidates, identityLinked })
    const report = await inspectWorkoutHistoryTarget(f.owner, f.runtime, journalTarget, historyFixtureIds[0])
    assert.equal(report.retainedLoginBinding, candidates.length === 1)
    assert.equal(report.yandexIdentityLinked, identityLinked)
    assert.ok(f.queries.find(q => q.actor === 'owner' && q.text.includes('auth_identities')))
    assert.doesNotMatch(JSON.stringify(report), /a0000000|[ac]{64}/)
    assert.ok(f.queries.every(q => !/\b(?:insert|update|delete|alter|grant|truncate)\b/i.test(q.text)))
  }
})
